import { useState, useEffect } from 'react';
import {
  Plus,
  ChevronUp,
  ChevronDown,
  Trash2,
  Check,
  RotateCcw,
  RefreshCw,
  ShieldAlert
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission } from '../lib/permissions';
import Skeleton from './common/Skeleton';
import '../styles/pipeline.css';

const AUTO_DOT_CLASSES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'nurture'];

export default function PipelineSettingsView({ currentUser }) {
  const canView = hasPermission(currentUser, 'pipeline', 'view');
  const canEdit = hasPermission(currentUser, 'pipeline', 'edit');
  const canDelete = hasPermission(currentUser, 'pipeline', 'delete');

  const [pipelines, setPipelines] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_pipelines');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [activePipelineId, setActivePipelineId] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_pipelines');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed[0]?.id) {
          const def = parsed.find((p) => p.is_default) || parsed[0];
          return def.id;
        }
      }
    } catch (e) {}
    return null;
  });
  const [stages, setStages] = useState(() => {
    try {
      const cachedCol = localStorage.getItem('crm_pipeline_columns');
      if (cachedCol) {
        const parsed = JSON.parse(cachedCol);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [initialStages, setInitialStages] = useState(() => {
    try {
      const cachedCol = localStorage.getItem('crm_pipeline_columns');
      if (cachedCol) {
        const parsed = JSON.parse(cachedCol);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  });
  const [leadCounts, setLeadCounts] = useState({});
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cachedCol = localStorage.getItem('crm_pipeline_columns');
      if (cachedCol) {
        const parsed = JSON.parse(cachedCol);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch (e) {}
    return true;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // New stage form state
  const [newStageName, setNewStageName] = useState('');

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => {
      setToast(null);
    }, 2800);
  };

  // Determine dirty state (unsaved changes)
  const isDirty = JSON.stringify(stages) !== JSON.stringify(initialStages);

  // Fetch pipelines from Supabase
  useEffect(() => {
    let isMounted = true;

    async function loadPipelinesAndLeads() {
      if (stages.length === 0) {
        setIsLoading(true);
      }
      try {
        const [pipeRes, leadsRes] = await Promise.all([
          supabase
            .from('pipelines')
            .select('*')
            .order('is_default', { ascending: false }),
          supabase.from('leads').select('stage')
        ]);

        if (pipeRes.error) throw pipeRes.error;

        if (isMounted && pipeRes.data && pipeRes.data.length > 0) {
          setPipelines(pipeRes.data);
          try {
            localStorage.setItem('crm_cached_pipelines', JSON.stringify(pipeRes.data));
          } catch (e) {}
          const defaultPipe = pipeRes.data.find((p) => p.is_default) || pipeRes.data[0];
          setActivePipelineId(defaultPipe.id);
          const rawStages = defaultPipe.stages || [];
          setStages(rawStages);
          setInitialStages(rawStages);
        }

        if (isMounted && leadsRes.data) {
          const counts = {};
          leadsRes.data.forEach((l) => {
            const st = l.stage || 'new';
            counts[st] = (counts[st] || 0) + 1;
          });
          setLeadCounts(counts);
        }
      } catch (err) {
        console.error('Error loading pipeline data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadPipelinesAndLeads();

    return () => {
      isMounted = false;
    };
  }, []);

  // Switch active pipeline
  const handleSelectPipeline = (pipeId) => {
    setActivePipelineId(pipeId);
    const selected = pipelines.find((p) => p.id === pipeId);
    if (selected) {
      const rawStages = selected.stages || [];
      setStages(rawStages);
      setInitialStages(rawStages);
    }
  };

  // Discard changes
  const handleReset = () => {
    setStages(initialStages);
    showToast('Discarded unsaved changes.');
  };

  // Move stage UP
  const handleMoveUp = (index) => {
    if (index === 0) return;
    setStages((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy.map((st, i) => ({ ...st, order: i }));
    });
  };

  // Move stage DOWN
  const handleMoveDown = (index) => {
    if (index === stages.length - 1) return;
    setStages((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy.map((st, i) => ({ ...st, order: i }));
    });
  };

  // Update stage label
  const handleLabelChange = (index, newLabel) => {
    setStages((prev) =>
      prev.map((st, i) => (i === index ? { ...st, label: newLabel } : st))
    );
  };

  // Set explicit entry stage
  const handleSetEntryStage = (stageId) => {
    setStages((prev) =>
      prev.map((st) => ({
        ...st,
        is_entry: st.id === stageId
      }))
    );
    const target = stages.find((s) => s.id === stageId);
    showToast(`Set "${target?.label || stageId}" as the Entry Stage.`);
  };

  // Delete stage with orphan migration
  const handleDeleteStage = async (index) => {
    const stageToDelete = stages[index];
    if (stageToDelete.is_entry) {
      showToast('The designated Entry Stage cannot be deleted. Select another stage as the Entry Stage first.');
      return;
    }

    if (stages.length <= 2) {
      showToast('A pipeline requires at least 2 stages.');
      return;
    }

    const fallbackStage = stages.find((s) => s.is_entry && s.id !== stageToDelete.id) || stages[0];
    const fallbackStageId = fallbackStage?.id;

    try {
      const { data: affectedLeads, error: selectErr } = await supabase
        .from('leads')
        .select('id')
        .eq('stage', stageToDelete.id);

      if (!selectErr && affectedLeads && affectedLeads.length > 0) {
        const { error: updateErr } = await supabase
          .from('leads')
          .update({ stage: fallbackStageId })
          .eq('stage', stageToDelete.id);

        if (!updateErr) {
          showToast(`Migrated ${affectedLeads.length} lead${affectedLeads.length > 1 ? 's' : ''} to "${fallbackStage?.label || 'Entry Stage'}".`);
          setLeadCounts((prev) => ({
            ...prev,
            [fallbackStageId]: (prev[fallbackStageId] || 0) + affectedLeads.length,
            [stageToDelete.id]: 0
          }));
        }
      }
    } catch (err) {
      console.warn('Error migrating leads on delete:', err);
    }

    setStages((prev) => prev.filter((_, i) => i !== index).map((st, i) => ({ ...st, order: i })));
  };

  // Add new stage
  const handleAddStage = (e) => {
    e.preventDefault();
    if (!newStageName.trim()) return;

    const baseId = newStageName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '_');
    const uniqueId = stages.some((s) => s.id === baseId)
      ? `${baseId}_${Date.now().toString().slice(-4)}`
      : baseId;

    const autoDotClass = AUTO_DOT_CLASSES[stages.length % AUTO_DOT_CLASSES.length];

    const newStageObj = {
      id: uniqueId,
      label: newStageName.trim(),
      dotClass: autoDotClass,
      order: stages.length,
      is_entry: false
    };

    setStages((prev) => [...prev, newStageObj]);
    setNewStageName('');
    showToast(`Added stage "${newStageObj.label}"`);
  };

  // Save changes to Supabase
  const handleSave = async () => {
    if (!activePipelineId) return;
    setIsSaving(true);

    try {
      const normalizedStages = stages.map((st, idx) => ({
        id: st.id,
        label: st.label,
        dotClass: st.dotClass || AUTO_DOT_CLASSES[idx % AUTO_DOT_CLASSES.length],
        order: idx,
        is_entry: Boolean(st.is_entry)
      }));

      const { error } = await supabase
        .from('pipelines')
        .update({
          stages: normalizedStages,
          updated_at: new Date().toISOString()
        })
        .eq('id', activePipelineId);

      if (error) throw error;

      setInitialStages(normalizedStages);
      setPipelines((prev) =>
        prev.map((p) =>
          p.id === activePipelineId ? { ...p, stages: normalizedStages } : p
        )
      );

      try {
        localStorage.setItem('crm_pipeline_columns', JSON.stringify(normalizedStages));
      } catch (e) {}

      showToast('Pipeline changes saved successfully.');
    } catch (err) {
      console.error('Error saving pipeline stages:', err);
      showToast('Failed to save pipeline changes.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="pipeline-view-container">
        <div className="pipeline-view-inner">
          <div className="pipeline-header-block">
            <div className="pipeline-header-left">
              <Skeleton width="180px" height="24px" />
              <Skeleton width="340px" height="14px" />
            </div>
            <Skeleton width="120px" height="32px" borderRadius="6px" />
          </div>
          <Skeleton width="100%" height="380px" borderRadius="8px" />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="pipeline-view-container">
        <div className="pipeline-view-inner" style={{ textAlign: 'center', padding: '64px 20px' }}>
          <div style={{ display: 'inline-flex', padding: '16px', background: '#f1f5f9', borderRadius: '50%', marginBottom: '16px', color: '#64748b' }}>
            <ShieldAlert size={32} strokeWidth={1.5} />
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>
            Access Restricted
          </h2>
          <p style={{ fontSize: '13.5px', color: '#64748b', maxWidth: '420px', margin: '0 auto', lineHeight: 1.5 }}>
            You do not have permission to view or manage pipeline stages. Please contact your CRM administrator to request access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pipeline-view-container">
      <div className="pipeline-view-inner">
        {/* Header Block */}
        <div className="pipeline-header-block">
          <div className="pipeline-header-left">
            <div className="pipeline-header-title-row">
              <h1 className="pipeline-title">Pipeline Stages</h1>
              {pipelines.length > 1 && (
                <select
                  value={activePipelineId}
                  onChange={(e) => handleSelectPipeline(e.target.value)}
                  className="pipeline-select-chip"
                >
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.is_default ? '(Default)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="pipeline-subtitle">
              Configure your deal stages and sequence. Stage #1 serves as the default entry point for incoming leads.
            </p>
          </div>

          {canEdit && (
            <div className="pipeline-header-actions">
              {isDirty && (
                <button
                  type="button"
                  className="btn-pipeline-ghost"
                  onClick={handleReset}
                  disabled={isSaving}
                  title="Discard unsaved changes"
                >
                  <RotateCcw size={13} />
                  <span>Discard</span>
                </button>
              )}

              <button
                type="button"
                className={`btn-pipeline-save ${isDirty ? 'active' : ''}`}
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <RefreshCw size={13} className="spin-icon" />
                    <span>Saving...</span>
                  </>
                ) : isDirty ? (
                  <>
                    <span className="unsaved-dot" />
                    <span>Save Changes</span>
                  </>
                ) : (
                  <>
                    <Check size={13} strokeWidth={2.5} />
                    <span>Saved</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Table Card */}
        <div className="pipeline-table-card">
          {/* Table Head */}
          <div className="pipeline-table-head">
            <div className="th-order">Order</div>
            <div className="th-stage">Stage Name</div>
            <div className="th-type">Type</div>
            <div className="th-volume">Active Leads</div>
            <div className="th-actions">{canEdit || canDelete ? 'Actions' : ''}</div>
          </div>

          {/* Rows Stack */}
          <div className="pipeline-rows-stack">
            {stages.map((stage, idx) => {
              const count = leadCounts[stage.id] || 0;
              const isEntry = Boolean(stage.is_entry);

              return (
                <div
                  key={stage.id}
                  className={`pipeline-stage-row ${isEntry ? 'is-entry' : ''}`}
                >
                  {/* 1. Cell Order */}
                  <div className="cell-order">
                    <div className="order-reorder-group">
                      <button
                        type="button"
                        className="btn-reorder-chevron"
                        disabled={!canEdit || idx === 0}
                        onClick={() => handleMoveUp(idx)}
                        title={!canEdit ? 'Pipeline editing restricted' : 'Move up in pipeline'}
                      >
                        <ChevronUp size={11} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="btn-reorder-chevron"
                        disabled={!canEdit || idx === stages.length - 1}
                        onClick={() => handleMoveDown(idx)}
                        title={!canEdit ? 'Pipeline editing restricted' : 'Move down in pipeline'}
                      >
                        <ChevronDown size={11} strokeWidth={2.5} />
                      </button>
                    </div>
                    <span className="order-index-pill">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                  </div>

                  {/* 2. Cell Stage Name (Clean Input, Zero Color Circles) */}
                  <div className="cell-stage-name">
                    <input
                      type="text"
                      value={stage.label}
                      onChange={(e) => handleLabelChange(idx, e.target.value)}
                      className="stage-name-input-clean"
                      placeholder="Stage Name"
                      readOnly={!canEdit}
                      style={!canEdit ? { cursor: 'default', background: 'transparent' } : {}}
                    />
                  </div>

                  {/* 3. Cell Type */}
                  <div className="cell-type">
                    {isEntry ? (
                      <span
                        className="badge-entry-pill"
                        title="Default landing stage for incoming leads"
                      >
                        <span className="badge-pulse-dot" />
                        Entry Stage
                      </span>
                    ) : canEdit ? (
                      <button
                        type="button"
                        className="badge-set-entry-btn"
                        onClick={() => handleSetEntryStage(stage.id)}
                        title="Click to set this stage as the default landing stage for incoming leads"
                      >
                        Set as Entry
                      </button>
                    ) : null}
                  </div>

                  {/* 4. Cell Active Leads Volume */}
                  <div className="cell-volume">
                    <span className="lead-count-chip">
                      {count} {count === 1 ? 'lead' : 'leads'}
                    </span>
                  </div>

                  {/* 5. Cell Actions */}
                  <div className="cell-actions">
                    {canDelete ? (
                      <button
                        type="button"
                        className="btn-trash-action"
                        disabled={isEntry || stages.length <= 2}
                        onClick={() => handleDeleteStage(idx)}
                        title={
                          isEntry
                            ? 'The designated Entry Stage cannot be deleted. Set another stage as Entry Stage first.'
                            : stages.length <= 2
                            ? 'Minimum 2 stages required'
                            : `Remove stage (${count} lead${count === 1 ? '' : 's'} will migrate to Entry Stage)`
                        }
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#cbd5e1' }}>—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inline Add Stage Footer */}
          {canEdit && (
            <form onSubmit={handleAddStage} className="pipeline-inline-add-row">
              <input
                type="text"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="Add new stage name (e.g. Discovery Call, Agreement Signed)..."
                className="inline-add-input"
              />

              <button
                type="submit"
                className="btn-inline-add-stage"
                disabled={!newStageName.trim()}
              >
                <Plus size={13} strokeWidth={2.5} />
                <span>Add Stage</span>
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Floating Toast Notification */}
      {toast && (
        <div className="pipeline-toast">
          <Check size={13} strokeWidth={2.5} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
