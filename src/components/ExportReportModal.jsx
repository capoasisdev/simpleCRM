import React, { useState, useMemo } from 'react';
import {
  X,
  Download,
  Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { resolveStageName } from '../lib/aiAssistant.js';
import '../styles/exportModal.css';

const CORE_FIELDS = [
  { key: 'name', label: 'Lead Name' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'email', label: 'Email Address' },
  { key: 'stage', label: 'Pipeline Stage' },
  { key: 'pipeline', label: 'Pipeline Name' },
  { key: 'assigned_to', label: 'Assigned Representative' },
  { key: 'city', label: 'City' },
  { key: 'value', label: 'Deal Value (₹)' },
  { key: 'source', label: 'Source / Form' },
  { key: 'created_at', label: 'Date Created' },
  { key: 'notes', label: 'Notes & Remarks' }
];

const MAX_EXPORT_LIMIT = 2000;

export default function ExportReportModal({
  isOpen,
  onClose,
  allLeads = [],
  filteredLeads = [],
  selectedLeadIds = new Set(),
  pipelinesList = [],
  activePipelineName = 'CapOasis CRM',
  onSuccess
}) {
  if (!isOpen) return null;

  // Scope: 'filtered' | 'selected'
  const [scope, setScope] = useState(() => {
    return selectedLeadIds && selectedLeadIds.size > 0 ? 'selected' : 'filtered';
  });

  // Date Range: 'this_month' | 'last_month' | 'past_30_days' | 'past_7_days' | 'today' | 'yesterday' | 'custom'
  const [dateRange, setDateRange] = useState('this_month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Format: 'xlsx' | 'csv'
  const [format, setFormat] = useState('xlsx');
  const [isExporting, setIsExporting] = useState(false);

  // 1. Identify Candidate Leads according to Scope
  const baseLeads = useMemo(() => {
    if (scope === 'selected' && selectedLeadIds.size > 0) {
      return allLeads.filter((l) => selectedLeadIds.has(l.id));
    }
    return filteredLeads.length > 0 ? filteredLeads : allLeads;
  }, [scope, selectedLeadIds, allLeads, filteredLeads]);

  // 2. Filter Candidate Leads by Date Range (Strictly bounded, no unbounded queries)
  const filteredByDate = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    const past30Start = todayStart - 30 * 24 * 60 * 60 * 1000;

    // This month (from 1st of current month to now)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // Last month (1st of previous month to last day of previous month)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    const lastMonthEnd = monthStart - 1;

    return baseLeads.filter((l) => {
      const d = l.created_at || l.date;
      if (!d) return false;
      const t = new Date(d).getTime();
      if (isNaN(t)) return false;

      if (dateRange === 'today') return t >= todayStart;
      if (dateRange === 'yesterday') return t >= yesterdayStart && t < todayStart;
      if (dateRange === 'past_7_days') return t >= weekStart;
      if (dateRange === 'past_30_days') return t >= past30Start;
      if (dateRange === 'this_month') return t >= monthStart;
      if (dateRange === 'last_month') return t >= lastMonthStart && t <= lastMonthEnd;

      if (dateRange === 'custom') {
        const start = customStartDate ? new Date(`${customStartDate}T00:00:00`).getTime() : past30Start;
        const end = customEndDate ? new Date(`${customEndDate}T23:59:59`).getTime() : Date.now();
        return t >= start && t <= end;
      }

      return t >= monthStart;
    });
  }, [baseLeads, dateRange, customStartDate, customEndDate]);

  // Row count safety cap to protect browser memory & sheet generation
  const isCapped = filteredByDate.length > MAX_EXPORT_LIMIT;
  const leadsToExport = useMemo(() => {
    return isCapped ? filteredByDate.slice(0, MAX_EXPORT_LIMIT) : filteredByDate;
  }, [filteredByDate, isCapped]);

  // 3. Extract unique, active Franchise custom fields ONLY from the leads being exported.
  // Merges case-variations (e.g. 'franchise' vs 'Franchise') and drops ghost columns with 0 answers.
  const activeCustomQuestions = useMemo(() => {
    if (!leadsToExport || leadsToExport.length === 0) return [];

    const questionMap = new Map();

    leadsToExport.forEach((lead) => {
      if (lead.custom_fields && typeof lead.custom_fields === 'object') {
        Object.entries(lead.custom_fields).forEach(([rawKey, val]) => {
          const trimmedKey = (rawKey || '').trim();
          if (!trimmedKey) return;

          const lower = trimmedKey.toLowerCase();
          // Skip internal IDs or metadata keys if present in custom_fields
          if (['form_id', 'page_id', 'lead_id', 'ad_id', 'adset_id', 'campaign_id'].includes(lower)) {
            return;
          }

          // Only register questions that have at least one non-empty value in this export
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            if (!questionMap.has(lower)) {
              questionMap.set(lower, trimmedKey);
            }
          }
        });
      }
    });

    return Array.from(questionMap.values());
  }, [leadsToExport]);

  // Helper to extract question values case-insensitively
  const getQuestionValue = (customFields, canonicalQuestion) => {
    if (!customFields || typeof customFields !== 'object') return '';

    // 1. Direct key match
    if (customFields[canonicalQuestion] !== undefined && customFields[canonicalQuestion] !== null) {
      const val = String(customFields[canonicalQuestion]).trim();
      if (val) return val;
    }

    // 2. Case-insensitive lookup
    const targetNorm = canonicalQuestion.trim().toLowerCase();
    for (const [k, v] of Object.entries(customFields)) {
      if (k && k.trim().toLowerCase() === targetNorm) {
        if (v !== undefined && v !== null) {
          const str = String(v).trim();
          if (str) return str;
        }
      }
    }

    return '';
  };

  // 4. Generate & Trigger Download
  const handleDownloadReport = async () => {
    if (leadsToExport.length === 0) {
      alert('No leads match the selected scope and date range.');
      return;
    }

    setIsExporting(true);

    try {
      // Transform leads into table rows with core fields and populated franchise questions
      const rows = leadsToExport.map((lead) => {
        const row = {
          'Lead Name': lead.name || '',
          'Phone Number': lead.phone || '',
          'Email Address': lead.email || '',
          'Pipeline Stage': resolveStageName(lead.stage, pipelinesList),
          'Pipeline Name': (() => {
            const p = pipelinesList.find((pipe) => pipe.id === lead.pipeline_id);
            return p?.name || activePipelineName || 'Default Pipeline';
          })(),
          'Assigned Representative': lead.assigned_to || lead.assignedTo || 'Unassigned',
          'City': lead.city || lead.custom_fields?.['City'] || lead.custom_fields?.['city'] || '',
          'Deal Value (₹)': Number(lead.value || lead.deal_value || 0),
          'Source / Form': lead.form_name || lead.source || lead.custom_fields?.['form_name'] || 'Meta Ads',
          'Date Created': (() => {
            const rawDate = lead.created_at || lead.date;
            if (!rawDate) return '';
            const dt = new Date(rawDate);
            return isNaN(dt.getTime()) ? String(rawDate) : dt.toLocaleString('en-IN');
          })(),
          'Notes & Remarks': lead.notes || ''
        };

        // Append only active custom questions that contain data in this export
        activeCustomQuestions.forEach((q) => {
          row[q] = getQuestionValue(lead.custom_fields, q);
        });

        return row;
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);

      // Auto-fit column widths
      const allHeaders = [...CORE_FIELDS.map((f) => f.label), ...activeCustomQuestions];
      worksheet['!cols'] = allHeaders.map((header) => {
        let maxLen = header.length;
        rows.slice(0, 100).forEach((r) => {
          const valLen = String(r[header] || '').length;
          if (valLen > maxLen) maxLen = Math.min(valLen, 45);
        });
        return { wch: Math.max(maxLen + 4, 12) };
      });

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads Export');

      const dateTag = new Date().toISOString().slice(0, 10);
      const filename = `crm-leads-report-${dateTag}.${format}`;

      if (format === 'csv') {
        XLSX.writeFile(workbook, filename, { bookType: 'csv' });
      } else {
        XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
      }

      if (onSuccess) {
        onSuccess(`Exported ${leadsToExport.length} leads to ${filename}`);
      }

      onClose();
    } catch (err) {
      console.error('Error generating report:', err);
      alert('Failed to generate export file. Please check console for details.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="export-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="export-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="export-modal-header">
          <div>
            <h3 className="export-modal-title">Export Leads</h3>
            <p className="export-modal-subtitle">
              {leadsToExport.length} {leadsToExport.length === 1 ? 'lead' : 'leads'} matching filters
            </p>
          </div>
          <button
            type="button"
            className="export-modal-close-btn"
            onClick={onClose}
            aria-label="Close export modal"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Compact Form */}
        <div className="export-modal-form">
          {/* Scope Segmented Bar */}
          <div className="export-form-group">
            <label className="export-form-label">Data Scope</label>
            <div className="export-segmented-bar">
              <button
                type="button"
                className={`export-segmented-btn ${scope === 'filtered' ? 'active' : ''}`}
                onClick={() => setScope('filtered')}
              >
                <span>Current View</span>
                <span className="export-badge-count">{filteredLeads.length}</span>
              </button>

              <button
                type="button"
                className={`export-segmented-btn ${scope === 'selected' ? 'active' : ''} ${selectedLeadIds.size === 0 ? 'disabled' : ''}`}
                onClick={() => {
                  if (selectedLeadIds.size > 0) setScope('selected');
                }}
              >
                <span>Selected Leads</span>
                <span className="export-badge-count">{selectedLeadIds.size}</span>
              </button>
            </div>
          </div>

          {/* Date Filter */}
          <div className="export-form-group">
            <label className="export-form-label">Date Filter</label>
            <select
              className="export-select-input"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
            >
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="past_30_days">Past 30 Days</option>
              <option value="past_7_days">Past 7 Days</option>
              <option value="today">Created Today</option>
              <option value="yesterday">Created Yesterday</option>
              <option value="custom">Custom Date Range...</option>
            </select>

            {dateRange === 'custom' && (
              <div className="export-date-range-row">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  placeholder="Start Date"
                />
                <span className="export-date-range-sep">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  placeholder="End Date"
                />
              </div>
            )}
          </div>

          {isCapped && (
            <div className="export-warning-banner">
              Safety Limit: Export capped at {MAX_EXPORT_LIMIT.toLocaleString()} rows ({filteredByDate.length.toLocaleString()} total found). Use the Date Filter to export specific windows.
            </div>
          )}

          {/* Format Segmented Bar */}
          <div className="export-form-group">
            <label className="export-form-label">File Format</label>
            <div className="export-segmented-bar">
              <button
                type="button"
                className={`export-segmented-btn ${format === 'xlsx' ? 'active' : ''}`}
                onClick={() => setFormat('xlsx')}
              >
                <span>Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                className={`export-segmented-btn ${format === 'csv' ? 'active' : ''}`}
                onClick={() => setFormat('csv')}
              >
                <span>CSV (.csv)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="export-modal-footer">
          <div className="export-footer-summary">
            Ready to export <strong>{leadsToExport.length}</strong> leads
          </div>
          <div className="export-footer-actions">
            <button
              type="button"
              className="export-btn-cancel"
              onClick={onClose}
              disabled={isExporting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="export-btn-submit"
              onClick={handleDownloadReport}
              disabled={isExporting || leadsToExport.length === 0}
            >
              {isExporting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <Download size={13} strokeWidth={2.2} />
                  <span>Export {format.toUpperCase()}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
