import { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Users,
  GitBranch,
  ShieldCheck,
  ChevronDown,
  ArrowRight,
  RotateCcw,
  Check,
  FileText,
  AlertCircle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import '../styles/csvImport.css';

// Normalize phone to last 10 digits for duplicate matching across countries / formats
const normalizePhone = (raw) => {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
};

const normalizeEmail = (raw) => {
  if (!raw) return '';
  return String(raw).trim().toLowerCase();
};

export default function CsvImportView({ currentUser, onNavigate }) {
  // Steps: 'upload' -> 'map' -> 'preview' -> 'importing' -> 'result'
  const [step, setStep] = useState('upload');
  const [file, setFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Raw parsed CSV
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);

  // Field Mapping (System Field -> CSV Column Name)
  const [mapping, setMapping] = useState({
    name: '',
    phone: '',
    email: '',
    city: '',
    notes: '',
    stage: ''
  });

  // Routing and Assignee options
  const [applyRouting, setApplyRouting] = useState(true);
  const [defaultAssignee, setDefaultAssignee] = useState('pranav');
  const [usersList, setUsersList] = useState([]);
  const [routingConfig, setRoutingConfig] = useState(null);
  const [pipelinesList, setPipelinesList] = useState([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState('');
  const [pipelineStages, setPipelineStages] = useState([]);
  const [entryStageId, setEntryStageId] = useState('new');

  // Duplicate prevention & validation analysis
  const [analyzedRows, setAnalyzedRows] = useState([]);
  const [stats, setStats] = useState({ total: 0, valid: 0, duplicates: 0, invalid: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Import execution
  const [progress, setProgress] = useState(0);
  const [importResult, setImportResult] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  // Load CRM users, Lead Routing Config, and Pipeline Stages
  useEffect(() => {
    let isMounted = true;

    async function loadMetadata() {
      try {
        // 1. Fetch CRM users
        const { data: usersData } = await supabase
          .from('crm_users')
          .select('id, name, email')
          .order('name', { ascending: true });
        if (usersData && isMounted) {
          setUsersList(usersData);
          if (currentUser?.name) {
            setDefaultAssignee(currentUser.name);
          } else if (usersData.length > 0) {
            setDefaultAssignee(usersData[0].name);
          }
        }

        // 2. Fetch Lead Routing Config
        const { data: rData } = await supabase
          .from('lead_routing_config')
          .select('*')
          .limit(1)
          .maybeSingle();
        if (rData && isMounted) {
          setRoutingConfig(rData);
        }

        // 3. Fetch all Pipelines
        const { data: allPipelines } = await supabase
          .from('pipelines')
          .select('id, name, is_default, stages')
          .order('is_default', { ascending: false });

        if (allPipelines && allPipelines.length > 0 && isMounted) {
          setPipelinesList(allPipelines);
          const defaultPipe = allPipelines.find(p => p.is_default) || allPipelines[0];
          setSelectedPipelineId(defaultPipe.id);
          const stages = Array.isArray(defaultPipe.stages) ? defaultPipe.stages : [];
          setPipelineStages(stages);
          const entry = stages.find(s => s.is_entry === true);
          const fbNew = stages.find(s => s.id === 'new');
          setEntryStageId(entry?.id || fbNew?.id || stages[0]?.id || 'new');
        }
      } catch (err) {
        console.warn('Error loading metadata for CSV import:', err);
      }
    }

    loadMetadata();
    return () => { isMounted = false; };
  }, [currentUser]);

  const handlePipelineChange = (newPipelineId) => {
    setSelectedPipelineId(newPipelineId);
    const chosen = pipelinesList.find(p => p.id === newPipelineId);
    if (chosen && Array.isArray(chosen.stages)) {
      setPipelineStages(chosen.stages);
      const entry = chosen.stages.find(s => s.is_entry === true);
      const fbNew = chosen.stages.find(s => s.id === 'new');
      setEntryStageId(entry?.id || fbNew?.id || chosen.stages[0]?.id || 'new');
    }
  };

  // Auto-detect CSV/TSV Delimiter (\t, ,, ;, |)
  const detectDelimiter = (text) => {
    const sampleLines = text.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0).slice(0, 5);
    if (sampleLines.length === 0) return ',';

    const candidates = [',', '\t', ';', '|'];
    const scores = { ',': 0, '\t': 0, ';': 0, '|': 0 };

    for (const delim of candidates) {
      let prevCount = -1;
      let consistent = true;
      let total = 0;

      for (const line of sampleLines) {
        let count = 0;
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') inQuotes = !inQuotes;
          else if (line[i] === delim && !inQuotes) count++;
        }
        total += count;
        if (prevCount !== -1 && count !== prevCount) {
          consistent = false;
        }
        prevCount = count;
      }

      scores[delim] = total * (consistent && total > 0 ? 3 : 1);
    }

    let bestDelim = ',';
    let maxScore = 0;
    for (const [delim, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestDelim = delim;
      }
    }

    return maxScore > 0 ? bestDelim : ',';
  };

  // Robust CSV/TSV Line Parser handling quotes, multi-delimiters, CRLF, BOM
  const parseCSV = (text) => {
    // Strip BOM if present (UTF-8 or UTF-16)
    const clean = text.replace(/^[\uFEFF\uFFFE]/, '');
    const delimiter = detectDelimiter(clean);

    const lines = [];
    let currentLine = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < clean.length; i++) {
      const char = clean[i];
      const nextChar = clean[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        currentLine.push(currentField.trim());
        currentField = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentLine.push(currentField.trim());
        if (currentLine.some(f => f.length > 0)) {
          lines.push(currentLine);
        }
        currentLine = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }

    if (currentField.length > 0 || currentLine.length > 0) {
      currentLine.push(currentField.trim());
      if (currentLine.some(f => f.length > 0)) {
        lines.push(currentLine);
      }
    }

    return lines;
  };

  // Download Sample Template CSV
  const handleDownloadSample = () => {
    const csvContent =
      'Name,Phone,Email,City,Notes,Stage\n' +
      'Rajesh Kumar,+91 98765 43210,rajesh.kumar@example.com,Mumbai,Interested in Enterprise plan,new\n' +
      'Pooja Sharma,+91 98123 45678,pooja.sharma@example.com,Bengaluru,Requested product demo,new\n' +
      'Amit Patel,+91 99011 22334,amit.patel@example.com,Ahmedabad,Lead from trade show,contacted';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'simplecrm_leads_sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Process File Selection
  const handleFileChange = (selectedFile) => {
    if (!selectedFile) return;
    const lowerName = selectedFile.name.toLowerCase();
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.tsv') && !lowerName.endsWith('.txt')) {
      alert('Please upload a valid .csv or .tsv file.');
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const parsedLines = parseCSV(content);

      if (parsedLines.length < 2) {
        alert('CSV file appears to be empty or has no header row.');
        setFile(null);
        return;
      }

      const headers = parsedLines[0];
      const rows = parsedLines.slice(1);

      setCsvHeaders(headers);
      setCsvRows(rows);

      // Auto-detect mappings
      const autoMap = {
        name: '',
        phone: '',
        email: '',
        city: '',
        notes: '',
        stage: ''
      };

      headers.forEach(h => {
        const cleanH = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!autoMap.name && /^(name|fullname|contactname|customer|leadname|contact|firstlastname)$/i.test(cleanH)) {
          autoMap.name = h;
        } else if (!autoMap.phone && /^(phone|mobile|cell|contactno|phonenumber|mobileno|phoneno|telephone)$/i.test(cleanH)) {
          autoMap.phone = h;
        } else if (!autoMap.email && /^(email|mail|emailaddress|e-mail)$/i.test(cleanH)) {
          autoMap.email = h;
        } else if (!autoMap.city && /^(city|location|town|state|address)$/i.test(cleanH)) {
          autoMap.city = h;
        } else if (!autoMap.notes && /^(notes|note|comments|comment|remarks|remark|description|whichfranchisepackageareyouinterestedin|packagerequirement)$/i.test(cleanH)) {
          autoMap.notes = h;
        } else if (!autoMap.stage && /^(stage|status)$/i.test(cleanH)) {
          autoMap.stage = h;
        }
      });

      setMapping(autoMap);
      setStep('map');
    };
    reader.readAsText(selectedFile);
  };

  // Analyze Rows against Database for Duplicates & Validation
  const handleAnalyzeAndPreview = async () => {
    if (!mapping.name) {
      alert('Please map at least the "Lead Name" column.');
      return;
    }

    setIsAnalyzing(true);
    setStep('preview');

    try {
      // Fetch all existing leads (phones & emails) for strict deduplication
      const { data: existingLeads, error: dbErr } = await supabase
        .from('leads')
        .select('name, phone, email');

      if (dbErr) throw dbErr;

      const existingPhoneSet = new Set();
      const existingEmailSet = new Set();

      (existingLeads || []).forEach(lead => {
        const pNorm = normalizePhone(lead.phone);
        if (pNorm) existingPhoneSet.add(pNorm);
        const eNorm = normalizeEmail(lead.email);
        if (eNorm) existingEmailSet.add(eNorm);
      });

      // Track in-file duplicates
      const seenPhonesInBatch = new Set();
      const seenEmailsInBatch = new Set();

      const nameIdx = csvHeaders.indexOf(mapping.name);
      const phoneIdx = mapping.phone ? csvHeaders.indexOf(mapping.phone) : -1;
      const emailIdx = mapping.email ? csvHeaders.indexOf(mapping.email) : -1;
      const cityIdx = mapping.city ? csvHeaders.indexOf(mapping.city) : -1;
      const notesIdx = mapping.notes ? csvHeaders.indexOf(mapping.notes) : -1;
      const stageIdx = mapping.stage ? csvHeaders.indexOf(mapping.stage) : -1;

      let validCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;

      const analyzed = csvRows.map((row, idx) => {
        const name = (nameIdx >= 0 ? row[nameIdx] : '')?.trim();
        const phone = (phoneIdx >= 0 ? row[phoneIdx] : '')?.trim();
        const email = (emailIdx >= 0 ? row[emailIdx] : '')?.trim();
        const city = (cityIdx >= 0 ? row[cityIdx] : '')?.trim();
        const notes = (notesIdx >= 0 ? row[notesIdx] : '')?.trim();
        let stage = (stageIdx >= 0 ? row[stageIdx] : '')?.trim();

        if (!stage) stage = entryStageId;

        // Validation: Must have at least a Name
        if (!name) {
          invalidCount++;
          return {
            rowNum: idx + 2,
            name: '(Empty Name)',
            phone,
            email,
            city,
            notes,
            stage,
            status: 'invalid',
            reason: 'Missing required contact name'
          };
        }

        const normP = normalizePhone(phone);
        const normE = normalizeEmail(email);

        // Deduplication checks:
        let isDup = false;
        let dupReason = '';

        if (normP && existingPhoneSet.has(normP)) {
          isDup = true;
          dupReason = `Phone exists in CRM (${phone})`;
        } else if (normE && existingEmailSet.has(normE)) {
          isDup = true;
          dupReason = `Email exists in CRM (${email})`;
        } else if (normP && seenPhonesInBatch.has(normP)) {
          isDup = true;
          dupReason = `Duplicate phone within CSV file (${phone})`;
        } else if (normE && seenEmailsInBatch.has(normE)) {
          isDup = true;
          dupReason = `Duplicate email within CSV file (${email})`;
        }

        if (isDup) {
          duplicateCount++;
          return {
            rowNum: idx + 2,
            name,
            phone,
            email,
            city,
            notes,
            stage,
            status: 'duplicate',
            reason: dupReason
          };
        }

        // Add to batch sets
        if (normP) seenPhonesInBatch.add(normP);
        if (normE) seenEmailsInBatch.add(normE);

        validCount++;
        return {
          rowNum: idx + 2,
          name,
          phone,
          email,
          city,
          notes,
          stage,
          status: 'ready',
          reason: 'Ready to import'
        };
      });

      setAnalyzedRows(analyzed);
      setStats({
        total: csvRows.length,
        valid: validCount,
        duplicates: duplicateCount,
        invalid: invalidCount
      });
    } catch (err) {
      console.error('Error analyzing CSV rows:', err);
      alert(`Error analyzing duplicates: ${err.message}`);
      setStep('map');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Perform Batch Lead Insertion
  const handleExecuteImport = async () => {
    const readyToImport = analyzedRows.filter(r => r.status === 'ready');
    if (readyToImport.length === 0) {
      alert('No valid leads available to import.');
      return;
    }

    setIsImporting(true);
    setStep('importing');
    setProgress(0);

    try {
      // Prepare Routing parameters
      let activeRules = [];
      let routingMode = 'unassigned';
      let rIndex = 0;
      let rConfigId = null;

      if (applyRouting) {
        const { data: latestConf } = await supabase
          .from('lead_routing_config')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (latestConf) {
          rConfigId = latestConf.id;
          routingMode = latestConf.mode || 'round_robin';
          rIndex = latestConf.round_robin_index || 0;
          activeRules = (latestConf.user_rules || []).filter(r => r.active !== false);
        }
      }

      const getAssignee = () => {
        if (!applyRouting) {
          return defaultAssignee || 'unassigned';
        }
        if (routingMode === 'unassigned') return 'unassigned';
        if (routingMode === 'single') return routingConfig?.default_assignee || defaultAssignee;
        if (routingMode === 'round_robin' && activeRules.length > 0) {
          const sel = activeRules[rIndex % activeRules.length];
          rIndex++;
          return sel.name || sel.email || defaultAssignee;
        }
        if (routingMode === 'weighted') {
          const weighted = activeRules.filter(r => Number(r.weight) > 0);
          const sum = weighted.reduce((acc, r) => acc + Number(r.weight), 0);
          if (weighted.length > 0 && sum > 0) {
            const rand = Math.random() * sum;
            let running = 0;
            for (const r of weighted) {
              running += Number(r.weight);
              if (rand <= running) return r.name || r.email || defaultAssignee;
            }
          }
        }
        return defaultAssignee || 'unassigned';
      };

      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

      // Chunk leads in batches of 50
      const BATCH_SIZE = 50;
      let insertedCount = 0;
      const totalReady = readyToImport.length;

      for (let i = 0; i < totalReady; i += BATCH_SIZE) {
        const batch = readyToImport.slice(i, i + BATCH_SIZE);
        const payload = batch.map(lead => {
          const assignedTo = getAssignee();
          return {
            name: lead.name,
            phone: lead.phone || null,
            email: lead.email || null,
            city: lead.city || null,
            notes: lead.notes || null,
            stage: lead.stage || entryStageId,
            pipeline_id: selectedPipelineId || null,
            assigned_to: assignedTo,
            form_name: 'CSV Bulk Import',
            date: dateStr,
            created_at: new Date().toISOString()
          };
        });

        const { error: insertErr } = await supabase.from('leads').insert(payload);
        if (insertErr) throw insertErr;

        insertedCount += payload.length;
        setProgress(Math.round((insertedCount / totalReady) * 100));
      }

      // Update round robin index in lead_routing_config if applicable
      if (applyRouting && rConfigId && rIndex > 0) {
        await supabase
          .from('lead_routing_config')
          .update({
            round_robin_index: rIndex,
            updated_at: new Date().toISOString()
          })
          .eq('id', rConfigId);
      }

      setImportResult({
        totalProcessed: stats.total,
        imported: insertedCount,
        skippedDuplicates: stats.duplicates,
        invalid: stats.invalid,
        duplicatesList: analyzedRows.filter(r => r.status === 'duplicate')
      });

      setStep('result');
    } catch (err) {
      console.error('Import execution error:', err);
      alert(`Import failed: ${err.message}`);
      setStep('preview');
    } finally {
      setIsImporting(false);
    }
  };

  // Reset to import another file
  const handleReset = () => {
    setFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setAnalyzedRows([]);
    setImportResult(null);
    setProgress(0);
    setStep('upload');
  };

  return (
    <div className="csv-import-container">
      {/* Header */}
      <div className="csv-import-header">
        <div className="csv-header-titles">
          <h1 className="csv-main-title">
            <FileSpreadsheet size={22} strokeWidth={1.8} />
            Lead Import (CSV)
          </h1>
          <p className="csv-main-subtitle">
            Upload CSV spreadsheets to add leads in bulk with automatic column mapping, zero duplicate guarantee, and optional round-robin routing.
          </p>
        </div>

        <button
          type="button"
          className="csv-template-btn"
          onClick={handleDownloadSample}
          title="Download Sample CSV Template"
        >
          <Download size={14} />
          <span>Download Sample CSV</span>
        </button>
      </div>

      {/* Progress Steps Header */}
      <div className="csv-steps-bar">
        <div className={`csv-step-item ${step === 'upload' ? 'active' : 'completed'}`}>
          <div className="csv-step-num">1</div>
          <span>Upload File</span>
        </div>
        <div className="csv-step-divider" />
        <div className={`csv-step-item ${step === 'map' ? 'active' : ['preview', 'importing', 'result'].includes(step) ? 'completed' : ''}`}>
          <div className="csv-step-num">2</div>
          <span>Map Columns & Routing</span>
        </div>
        <div className="csv-step-divider" />
        <div className={`csv-step-item ${step === 'preview' ? 'active' : ['importing', 'result'].includes(step) ? 'completed' : ''}`}>
          <div className="csv-step-num">3</div>
          <span>Duplicate Check & Preview</span>
        </div>
        <div className="csv-step-divider" />
        <div className={`csv-step-item ${['importing', 'result'].includes(step) ? 'active' : ''}`}>
          <div className="csv-step-num">4</div>
          <span>Import</span>
        </div>
      </div>

      {/* STEP 1: Upload */}
      {step === 'upload' && (
        <div
          className={`csv-dropzone ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleFileChange(e.dataTransfer.files[0]);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".csv"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileChange(e.target.files[0]);
              }
            }}
          />
          <div className="csv-dropzone-icon">
            <UploadCloud size={24} />
          </div>
          <div className="csv-dropzone-title">Drag & drop your CSV file here</div>
          <div className="csv-dropzone-desc">Supports UTF-8 encoded .csv files up to 10MB</div>
          <button type="button" className="csv-browse-btn">
            Browse File
          </button>
        </div>
      )}

      {/* STEP 2: Map Columns & Settings */}
      {step === 'map' && (
        <div>
          {/* File Selected Banner */}
          <div className="csv-file-banner">
            <div className="csv-file-details">
              <FileSpreadsheet size={18} color="#0f172a" />
              <div>
                <span className="csv-file-name">{file?.name}</span>
                <span className="csv-file-meta" style={{ marginLeft: '12px' }}>
                  {csvRows.length} rows found • {(file?.size ? (file.size / 1024).toFixed(1) : 0)} KB
                </span>
              </div>
            </div>
            <button
              type="button"
              className="csv-file-remove"
              onClick={handleReset}
              title="Change File"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          {/* Column Mapping Card */}
          <div className="csv-card">
            <h2 className="csv-card-title">Column Mapping</h2>
            <p className="csv-card-desc">
              Match your CSV headers to SimpleCRM lead fields. Auto-matched fields are pre-selected.
            </p>

            <div className="csv-mapping-grid">
              <div className="csv-mapping-item">
                <label className="csv-mapping-label">
                  Lead Name <span className="csv-mapping-required">*Required</span>
                </label>
                <select
                  className="csv-select"
                  value={mapping.name}
                  onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
                >
                  <option value="">-- Select Column --</option>
                  {csvHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div className="csv-mapping-item">
                <label className="csv-mapping-label">
                  Phone Number <span style={{ fontSize: '11px', color: '#64748b' }}>(Recommended for dedup)</span>
                </label>
                <select
                  className="csv-select"
                  value={mapping.phone}
                  onChange={(e) => setMapping({ ...mapping, phone: e.target.value })}
                >
                  <option value="">-- Skip Column --</option>
                  {csvHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div className="csv-mapping-item">
                <label className="csv-mapping-label">
                  Email Address <span style={{ fontSize: '11px', color: '#64748b' }}>(Recommended for dedup)</span>
                </label>
                <select
                  className="csv-select"
                  value={mapping.email}
                  onChange={(e) => setMapping({ ...mapping, email: e.target.value })}
                >
                  <option value="">-- Skip Column --</option>
                  {csvHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div className="csv-mapping-item">
                <label className="csv-mapping-label">City / Location</label>
                <select
                  className="csv-select"
                  value={mapping.city}
                  onChange={(e) => setMapping({ ...mapping, city: e.target.value })}
                >
                  <option value="">-- Skip Column --</option>
                  {csvHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div className="csv-mapping-item">
                <label className="csv-mapping-label">Notes / Remarks</label>
                <select
                  className="csv-select"
                  value={mapping.notes}
                  onChange={(e) => setMapping({ ...mapping, notes: e.target.value })}
                >
                  <option value="">-- Skip Column --</option>
                  {csvHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div className="csv-mapping-item">
                <label className="csv-mapping-label">
                  Stage
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    (Defaults to entry stage)
                  </span>
                </label>
                <select
                  className="csv-select"
                  value={mapping.stage}
                  onChange={(e) => setMapping({ ...mapping, stage: e.target.value })}
                >
                  <option value="">Default Pipeline Entry Stage</option>
                  {csvHeaders.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {pipelinesList.length > 0 && (
                <div className="csv-mapping-item">
                  <label className="csv-mapping-label">
                    Target Pipeline
                  </label>
                  <select
                    className="csv-select"
                    value={selectedPipelineId}
                    onChange={(e) => handlePipelineChange(e.target.value)}
                  >
                    {pipelinesList.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.is_default ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Lead Routing & Distribution Options */}
          <div className="csv-card">
            <h2 className="csv-card-title">
              <GitBranch size={16} />
              Lead Distribution & Routing
            </h2>
            <p className="csv-card-desc">
              Choose whether to apply your automated Lead Routing rules or assign all imported leads to a specific team member.
            </p>

            <div className="csv-settings-box">
              <div className="csv-toggle-row">
                <label className="csv-toggle-label" htmlFor="routing-toggle">
                  <span className="csv-toggle-title">Apply Automatic Lead Routing Rules</span>
                  <span className="csv-toggle-desc">
                    Distributes imported leads according to your current lead routing rules (Round Robin or Weighted) and advances distribution counters.
                  </span>
                </label>
                <label className="csv-switch">
                  <input
                    id="routing-toggle"
                    type="checkbox"
                    checked={applyRouting}
                    onChange={(e) => setApplyRouting(e.target.checked)}
                  />
                  <span className="csv-slider" />
                </label>
              </div>

              {!applyRouting && (
                <div className="csv-assignee-row">
                  <label className="csv-mapping-label" style={{ minWidth: '160px' }}>
                    Assign All Leads To:
                  </label>
                  <select
                    className="csv-select"
                    style={{ flex: 1, maxWidth: '320px' }}
                    value={defaultAssignee}
                    onChange={(e) => setDefaultAssignee(e.target.value)}
                  >
                    <option value="unassigned">Unassigned</option>
                    {usersList.map(u => (
                      <option key={u.id} value={u.name || u.email}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Deduplication Guarantee Notice */}
          <div className="csv-dedup-badge" style={{ marginBottom: '20px' }}>
            <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Duplicate Prevention Active:</strong> In the next step, every row will be automatically checked against existing CRM leads by normalized phone number and email. Any duplicate will be safely skipped.
            </div>
          </div>

          {/* Navigation Actions */}
          <div className="csv-actions-bar">
            <button
              type="button"
              className="csv-btn-secondary"
              onClick={handleReset}
            >
              Cancel
            </button>
            <button
              type="button"
              className="csv-btn-primary"
              onClick={handleAnalyzeAndPreview}
              disabled={!mapping.name || isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw size={14} className="meta-spin" />
                  Checking Duplicates...
                </>
              ) : (
                <>
                  <span>Proceed to Preview</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Preview & Duplicate Audit */}
      {step === 'preview' && (
        <div>
          {/* Summary Stats Row */}
          <div className="csv-stats-row">
            <div className="csv-stat-box">
              <span className="csv-stat-val">{stats.total}</span>
              <span className="csv-stat-lbl">Total in CSV</span>
            </div>

            <div className="csv-stat-box success">
              <span className="csv-stat-val">{stats.valid}</span>
              <span className="csv-stat-lbl">Ready to Import</span>
            </div>

            <div className="csv-stat-box warning">
              <span className="csv-stat-val">{stats.duplicates}</span>
              <span className="csv-stat-lbl">Duplicates Skipped</span>
            </div>

            {stats.invalid > 0 && (
              <div className="csv-stat-box danger">
                <span className="csv-stat-val">{stats.invalid}</span>
                <span className="csv-stat-lbl">Invalid Rows</span>
              </div>
            )}
          </div>

          {/* Preview Table Card */}
          <div className="csv-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h2 className="csv-card-title">Preview & Duplicate Audit</h2>
                <p className="csv-card-desc" style={{ margin: 0 }}>
                  Showing preview of first 15 leads from your file and their validation status.
                </p>
              </div>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                {applyRouting ? 'Distribution: Lead Routing Active' : `Assignee: ${defaultAssignee}`}
              </span>
            </div>

            <div className="csv-table-wrapper">
              <table className="csv-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Status</th>
                    <th>Contact Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>City</th>
                    <th>Stage</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {analyzedRows.slice(0, 15).map((row) => (
                    <tr
                      key={row.rowNum}
                      className={
                        row.status === 'duplicate'
                          ? 'row-duplicate'
                          : row.status === 'invalid'
                          ? 'row-invalid'
                          : ''
                      }
                    >
                      <td style={{ color: '#94a3b8' }}>#{row.rowNum}</td>
                      <td>
                        {row.status === 'ready' && (
                          <span className="csv-badge ready">
                            <Check size={11} /> Ready
                          </span>
                        )}
                        {row.status === 'duplicate' && (
                          <span className="csv-badge duplicate">
                            <AlertTriangle size={11} /> Duplicate
                          </span>
                        )}
                        {row.status === 'invalid' && (
                          <span className="csv-badge invalid">
                            <XCircle size={11} /> Invalid
                          </span>
                        )}
                      </td>
                      <td style={{ fontWeight: 500 }}>{row.name}</td>
                      <td>{row.phone || '—'}</td>
                      <td>{row.email || '—'}</td>
                      <td>{row.city || '—'}</td>
                      <td>
                        <span style={{ fontSize: '11px', textTransform: 'capitalize' }}>
                          {row.stage}
                        </span>
                      </td>
                      <td style={{ color: row.status === 'ready' ? '#059669' : '#b45309' }}>
                        {row.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {analyzedRows.length > 15 && (
              <div style={{ textAlign: 'center', fontSize: '12px', color: '#64748b', marginTop: '8px' }}>
                + {analyzedRows.length - 15} more rows evaluated
              </div>
            )}
          </div>

          {/* Action Bar */}
          <div className="csv-actions-bar">
            <button
              type="button"
              className="csv-btn-secondary"
              onClick={() => setStep('map')}
              disabled={isImporting}
            >
              Back to Mapping
            </button>
            <button
              type="button"
              className="csv-btn-primary"
              onClick={handleExecuteImport}
              disabled={stats.valid === 0 || isImporting}
            >
              <UploadCloud size={14} />
              <span>Import {stats.valid} Leads</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Importing Execution */}
      {step === 'importing' && (
        <div className="csv-card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <RefreshCw size={32} className="meta-spin" style={{ margin: '0 auto 16px', color: '#0f172a' }} />
          <h2 style={{ fontSize: '17px', fontWeight: 600, color: '#0f172a', margin: '0 0 8px 0' }}>
            Importing Leads...
          </h2>
          <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0' }}>
            Inserting unique leads and applying routing rules. Please do not close this window.
          </p>

          <div className="csv-progress-wrapper" style={{ maxWidth: '420px', margin: '0 auto' }}>
            <div className="csv-progress-bar">
              <div className="csv-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="csv-progress-text">{progress}% Completed</div>
          </div>
        </div>
      )}

      {/* STEP 5: Results */}
      {step === 'result' && importResult && (
        <div className="csv-card">
          <div className="csv-result-box">
            <div className="csv-result-icon">
              <CheckCircle2 size={32} />
            </div>
            <h2 className="csv-result-title">Import Successfully Completed!</h2>
            <p className="csv-result-desc">
              Your leads have been imported and are now visible across your pipeline board and leads table.
            </p>

            <div className="csv-stats-row" style={{ width: '100%', maxWidth: '580px', marginBottom: '24px' }}>
              <div className="csv-stat-box success">
                <span className="csv-stat-val">{importResult.imported}</span>
                <span className="csv-stat-lbl">Leads Imported</span>
              </div>
              <div className="csv-stat-box warning">
                <span className="csv-stat-val">{importResult.skippedDuplicates}</span>
                <span className="csv-stat-lbl">Duplicates Skipped</span>
              </div>
              {importResult.invalid > 0 && (
                <div className="csv-stat-box danger">
                  <span className="csv-stat-val">{importResult.invalid}</span>
                  <span className="csv-stat-lbl">Invalid Rows</span>
                </div>
              )}
            </div>

            {/* Duplicates Detail Dropdown */}
            {importResult.skippedDuplicates > 0 && (
              <details className="csv-duplicates-detail">
                <summary className="csv-duplicates-summary">
                  View {importResult.skippedDuplicates} Skipped Duplicate Leads
                </summary>
                <div className="csv-duplicates-list">
                  {importResult.duplicatesList.map((d, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ fontWeight: 500 }}>{d.name} ({d.phone || d.email})</span>
                      <span style={{ color: '#b45309' }}>{d.reason}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                className="csv-btn-secondary"
                onClick={handleReset}
              >
                Import Another File
              </button>
              {onNavigate && (
                <button
                  type="button"
                  className="csv-btn-primary"
                  onClick={() => onNavigate('Leads')}
                >
                  <span>View Leads in Pipeline</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
