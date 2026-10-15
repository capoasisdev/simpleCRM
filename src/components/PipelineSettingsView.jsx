import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  ChevronUp,
  ChevronDown,
  Trash2,
  Check,
  RotateCcw,
  RefreshCw,
  ShieldAlert,
  Edit2,
  FileText,
  X
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
    } catch (e) { }
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
    } catch (e) { }
    return null;
  });

  const [stages, setStages] = useState(() => {
    try {
      const cachedCol = localStorage.getItem('crm_pipeline_columns');
      if (cachedCol) {
        const parsed = JSON.parse(cachedCol);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { }
    return [];
  });

  const [initialStages, setInitialStages] = useState(() => {
    try {
      const cachedCol = localStorage.getItem('crm_pipeline_columns');
      if (cachedCol) {
        const parsed = JSON.parse(cachedCol);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { }
    return [];
  });

  const [allLeads, setAllLeads] = useState([]);
  const [connectedForms, setConnectedForms] = useState([]);
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cachedCol = localStorage.getItem('crm_pipeline_columns');
      if (cachedCol) {
        const parsed = JSON.parse(cachedCol);
        if (Array.isArray(parsed) && parsed.length > 0) return false;
      }
    } catch (e) { }
    return true;
  });

  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // New stage form state
  const [newStageName, setNewStageName] = useState('');

  // Multi-pipeline creation state
  const [isCreatingPipeline, setIsCreatingPipeline] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');

  // Pipeline renaming state
  const [isEditingPipelineName, setIsEditingPipelineName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');

  // Attach form dropdown state
  const [isAttachDropdownOpen, setIsAttachDropdownOpen] = useState(false);
  const attachDropdownRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => {
      setToast(null);
    }, 2800);
  };

  // Close attach dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (attachDropdownRef.current && !attachDropdownRef.current.contains(e.target)) {
        setIsAttachDropdownOpen(false);
      }
    };
    if (isAttachDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isAttachDropdownOpen]);

  // Determine dirty state (unsaved changes in current pipeline's stages)
  const isDirty = JSON.stringify(stages) !== JSON.stringify(initialStages);

  // Active pipeline object
  const currentPipeline = pipelines.find((p) => p.id === activePipelineId) || pipelines[0];

  // Single form attached to active pipeline (1-to-1 mapping)
  const attachedForm = connectedForms.find((f) => f.pipeline_id === activePipelineId);

  // Scoped lead counts for active pipeline
  const activePipelineLeads = allLeads.filter(
    (l) => l.pipeline_id === activePipelineId || (!l.pipeline_id && currentPipeline?.is_default)
  );
  const leadCounts = {};
  activePipelineLeads.forEach((l) => {
    const st = l.stage || 'new';
    leadCounts[st] = (leadCounts[st] || 0) + 1;
  });

  // Fetch pipelines, leads, and forms from Supabase
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (stages.length === 0) {
        setIsLoading(true);
      }
      try {
        const [pipeRes, leadsRes, formsRes] = await Promise.all([
          supabase
            .from('pipelines')
            .select('*')
            .order('is_default', { ascending: false }),
          supabase.from('leads').select('id, stage, pipeline_id'),
          supabase.from('connected_forms').select('*')
        ]);

        if (pipeRes.error) throw pipeRes.error;

        if (isMounted && pipeRes.data && pipeRes.data.length > 0) {
          setPipelines(pipeRes.data);
          try {
            localStorage.setItem('crm_cached_pipelines', JSON.stringify(pipeRes.data));
          } catch (e) { }

          // Maintain active selection or pick default
          const targetPipe =
            pipeRes.data.find((p) => p.id === activePipelineId) ||
            pipeRes.data.find((p) => p.is_default) ||
            pipeRes.data[0];

          setActivePipelineId(targetPipe.id);
          const rawStages = targetPipe.stages || [];
          setStages(rawStages);
          setInitialStages(rawStages);
        }

        if (isMounted && leadsRes.data) {
          setAllLeads(leadsRes.data);
        }

        if (isMounted && formsRes.data) {
          setConnectedForms(formsRes.data);
        }
      } catch (err) {
        console.error('Error loading pipeline data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Switch active pipeline
  const handleSelectPipeline = (pipeId) => {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes in the current pipeline stages. Switch anyway?')) {
        return;
      }
    }
    setActivePipelineId(pipeId);
    setIsEditingPipelineName(false);
    const selected = pipelines.find((p) => p.id === pipeId);
    if (selected) {
      const rawStages = selected.stages || [];
      setStages(rawStages);
      setInitialStages(rawStages);
    }
  };

  // Create new pipeline
  const handleCreatePipelineSubmit = async (e) => {
    e.preventDefault();
    const name = newPipelineName.trim();
    if (!name) return;

    const starterStages = [
      { id: 'new', label: 'New Leads', dotClass: 'new', order: 0, is_entry: true },
      { id: 'contacted', label: 'Contacted', dotClass: 'contacted', order: 1, is_entry: false },
      { id: 'proposal', label: 'Proposal Sent', dotClass: 'proposal', order: 2, is_entry: false },
      { id: 'won', label: 'Won', dotClass: 'won', order: 3, is_entry: false },
      { id: 'lost', label: 'Lost', dotClass: 'nurture', order: 4, is_entry: false }
    ];

    try {
      const { data: newPipe, error } = await supabase
        .from('pipelines')
        .insert([{
          name,
          is_default: pipelines.length === 0,
          stages: starterStages
        }])
        .select()
        .single();

      if (error) throw error;

      const updated = [...pipelines, newPipe];
      setPipelines(updated);
      try {
        localStorage.setItem('crm_cached_pipelines', JSON.stringify(updated));
      } catch (e) { }

      setActivePipelineId(newPipe.id);
      setStages(starterStages);
      setInitialStages(starterStages);
      setIsCreatingPipeline(false);
      setNewPipelineName('');
      showToast(`Created pipeline "${newPipe.name}"`);
    } catch (err) {
      console.error('Error creating pipeline:', err);
      showToast('Failed to create pipeline.');
    }
  };

  // Rename pipeline
  const handleRenamePipelineSubmit = async (e) => {
    e.preventDefault();
    const newName = editingNameValue.trim();
    if (!newName || !activePipelineId) return;

    try {
      const { error } = await supabase
        .from('pipelines')
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq('id', activePipelineId);

      if (error) throw error;

      const updated = pipelines.map((p) =>
        p.id === activePipelineId ? { ...p, name: newName } : p
      );
      setPipelines(updated);
      try {
        localStorage.setItem('crm_cached_pipelines', JSON.stringify(updated));
      } catch (e) { }

      setIsEditingPipelineName(false);
      showToast('Pipeline renamed.');
    } catch (err) {
      console.error('Error renaming pipeline:', err);
      showToast('Failed to rename pipeline.');
    }
  };

  // Delete pipeline
  const handleDeletePipeline = async () => {
    if (pipelines.length <= 1) {
      showToast('Cannot delete the only pipeline.');
      return;
    }
    const target = currentPipeline;
    if (target?.is_default) {
      showToast('The default pipeline cannot be deleted.');
      return;
    }

    if (!window.confirm(`Delete pipeline "${target?.name}"? Any attached forms will be unlinked.`)) {
      return;
    }

    try {
      const { error } = await supabase.from('pipelines').delete().eq('id', activePipelineId);
      if (error) throw error;

      // Unlink forms in state
      setConnectedForms((prev) =>
        prev.map((f) => (f.pipeline_id === activePipelineId ? { ...f, pipeline_id: null } : f))
      );

      const remaining = pipelines.filter((p) => p.id !== activePipelineId);
      setPipelines(remaining);
      try {
        localStorage.setItem('crm_cached_pipelines', JSON.stringify(remaining));
      } catch (e) { }

      const nextActive = remaining.find((p) => p.is_default) || remaining[0];
      setActivePipelineId(nextActive.id);
      setStages(nextActive.stages || []);
      setInitialStages(nextActive.stages || []);
      showToast('Pipeline deleted.');
    } catch (err) {
      console.error('Error deleting pipeline:', err);
      showToast('Failed to delete pipeline.');
    }
  };

  // Set or unlink attached form for the active pipeline (1-to-1)
  const handleSetAttachedForm = async (targetFormId) => {
    try {
      // 1. Unlink whatever form was previously attached to activePipelineId
      if (attachedForm && attachedForm.form_id !== targetFormId) {
        await supabase
          .from('connected_forms')
          .update({ pipeline_id: null, updated_at: new Date().toISOString() })
          .eq('form_id', attachedForm.form_id);
      }

      // 2. If targetFormId provided, link it to activePipelineId
      if (targetFormId) {
        await supabase
          .from('connected_forms')
          .update({ pipeline_id: activePipelineId, updated_at: new Date().toISOString() })
          .eq('form_id', targetFormId);
      }

      // 3. Update local state
      setConnectedForms((prev) =>
        prev.map((f) => {
          if (f.form_id === targetFormId) {
            return { ...f, pipeline_id: activePipelineId };
          }
          if (f.pipeline_id === activePipelineId && f.form_id !== targetFormId) {
            return { ...f, pipeline_id: null };
          }
          return f;
        })
      );

      const formObj = connectedForms.find((f) => f.form_id === targetFormId);
      showToast(targetFormId ? `Attached "${formObj?.form_name || targetFormId}"` : 'Form unlinked from pipeline.');
    } catch (err) {
      console.error('Error updating form mapping:', err);
      showToast('Failed to update form attachment.');
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
    showToast(`Set "${target?.label || stageId}" as Entry Stage.`);
  };

  // Delete stage with orphan migration
  const handleDeleteStage = async (index) => {
    const stageToDelete = stages[index];
    if (stageToDelete.is_entry) {
      showToast('The designated Entry Stage cannot be deleted.');
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
        .eq('stage', stageToDelete.id)
        .eq('pipeline_id', activePipelineId);

      if (!selectErr && affectedLeads && affectedLeads.length > 0) {
        await supabase
          .from('leads')
          .update({ stage: fallbackStageId })
          .eq('stage', stageToDelete.id)
          .eq('pipeline_id', activePipelineId);

        setAllLeads((prev) =>
          prev.map((l) =>
            l.pipeline_id === activePipelineId && l.stage === stageToDelete.id
              ? { ...l, stage: fallbackStageId }
              : l
          )
        );
        showToast(`Migrated ${affectedLeads.length} lead(s) to "${fallbackStage?.label}".`);
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

      if (currentPipeline?.is_default) {
        try {
          localStorage.setItem('crm_pipeline_columns', JSON.stringify(normalizedStages));
        } catch (e) { }
      }

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

        {/* 1. Multi-Pipeline Switcher Tabs */}
        <div className="pipeline-switcher-container">
          <div className="pipeline-tabs-list">
            {pipelines.map((p) => {
              const isActive = p.id === activePipelineId;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`pipeline-tab-btn ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelectPipeline(p.id)}
                >
                  <span>{p.name}</span>
                  {p.is_default && <span className="pipeline-default-pill">Default</span>}
                </button>
              );
            })}

            {isCreatingPipeline ? (
              <form onSubmit={handleCreatePipelineSubmit} className="pipeline-new-form">
                <input
                  type="text"
                  autoFocus
                  placeholder="Pipeline name..."
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  className="pipeline-new-input"
                />
                <button type="submit" className="pipeline-new-submit-btn" disabled={!newPipelineName.trim()} title="Create">
                  <Check size={12} />
                </button>
                <button type="button" className="pipeline-new-cancel-btn" onClick={() => setIsCreatingPipeline(false)} title="Cancel">
                  <X size={12} />
                </button>
              </form>
            ) : (
              canEdit && (
                <button
                  type="button"
                  className="pipeline-add-tab-btn"
                  onClick={() => {
                    setNewPipelineName('');
                    setIsCreatingPipeline(true);
                  }}
                  title="Create new pipeline"
                >
                  <Plus size={13} />
                  <span>New Pipeline</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* 2. Active Pipeline Header Block */}
        <div className="pipeline-header-block">
          <div className="pipeline-header-left">
            <div className="pipeline-header-title-row">
              {isEditingPipelineName ? (
                <form onSubmit={handleRenamePipelineSubmit} className="pipeline-title-edit-wrap">
                  <input
                    type="text"
                    autoFocus
                    className="pipeline-title-input"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                  />
                  <button type="submit" className="pipeline-title-action-btn" title="Save name">
                    <Check size={14} color="#16a34a" />
                  </button>
                  <button
                    type="button"
                    className="pipeline-title-action-btn"
                    onClick={() => setIsEditingPipelineName(false)}
                    title="Cancel"
                  >
                    <X size={14} color="#dc2626" />
                  </button>
                </form>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h1 className="pipeline-title">{currentPipeline?.name || 'Pipeline Stages'}</h1>
                  {canEdit && (
                    <button
                      type="button"
                      className="pipeline-title-action-btn"
                      onClick={() => {
                        setEditingNameValue(currentPipeline?.name || '');
                        setIsEditingPipelineName(true);
                      }}
                      title="Rename pipeline"
                    >
                      <Edit2 size={12} />
                    </button>
                  )}
                  {canDelete && !currentPipeline?.is_default && pipelines.length > 1 && (
                    <button
                      type="button"
                      className="pipeline-delete-btn"
                      onClick={handleDeletePipeline}
                      title="Delete this pipeline"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="pipeline-subtitle">
              Configure stages and routing. Leads enter at the designated Entry Stage.
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

        {/* 3. Attached Lead Form (1-to-1 Mapping) */}
        <div className="pipeline-attached-forms-card">
          <div className="pipeline-attached-forms-left">
            <span className="pipeline-attached-label">Attached Form:</span>
            {attachedForm ? (
              <div className="pipeline-form-chip active-single">
                <FileText size={13} color="#2563eb" />
                <span className="pipeline-form-chip-name">
                  {attachedForm.form_name || `Form ${attachedForm.form_id}`}
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
                  ID: {attachedForm.form_id}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="pipeline-form-chip-remove"
                    onClick={() => handleSetAttachedForm(null)}
                    title="Unlink form from this pipeline"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ) : (
              <span className="pipeline-attached-empty">No lead form currently mapped to this pipeline</span>
            )}
          </div>

          {canEdit && connectedForms.length > 0 && (
            <div className="pipeline-attach-dropdown-wrap" ref={attachDropdownRef}>
              <button
                type="button"
                className="btn-attach-form-trigger"
                onClick={() => setIsAttachDropdownOpen(!isAttachDropdownOpen)}
              >
                <span>{attachedForm ? 'Switch Form' : 'Select Form'}</span>
                <ChevronDown size={12} />
              </button>

              {isAttachDropdownOpen && (
                <div className="pipeline-attach-dropdown-menu">
                  <div className="pipeline-attach-dropdown-header">Map a form to this pipeline:</div>
                  {connectedForms.map((f) => {
                    const isSelected = f.form_id === attachedForm?.form_id;
                    const otherPipe = f.pipeline_id && f.pipeline_id !== activePipelineId
                      ? pipelines.find((p) => p.id === f.pipeline_id)
                      : null;

                    return (
                      <div
                        key={f.id || f.form_id}
                        className={`pipeline-attach-dropdown-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          handleSetAttachedForm(f.form_id);
                          setIsAttachDropdownOpen(false);
                        }}
                      >
                        <FileText size={13} color={isSelected ? '#2563eb' : '#64748b'} />
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: '12.5px', fontWeight: isSelected ? 600 : 500, color: '#0f172a' }}>
                            {f.form_name || `Form ${f.form_id}`}
                          </span>
                          <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                            ID: {f.form_id} {otherPipe ? `• (Currently on: ${otherPipe.name})` : ''}
                          </span>
                        </div>
                        {isSelected && <Check size={12} color="#2563eb" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. Stages Table Card (Scoped to Active Pipeline) */}
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

                  {/* 2. Cell Stage Name */}
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
                        title="Click to set as default landing stage for incoming leads"
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
