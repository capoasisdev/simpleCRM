import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Check,
  RotateCcw,
  RefreshCw,
  ShieldAlert,
  Plus,
  ArrowLeft,
  ArrowRight,
  Edit2,
  Link2,
  GitFork,
  FileText,
  CheckCircle2,
  ArrowDownLeft,
  Unlink,
  Sliders
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission } from '../lib/permissions';
import Skeleton from './common/Skeleton';
import '../styles/pipeline.css';

export default function PipelineSettingsView({ currentUser, onConfigureStateChange }) {
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

  // State A: null = viewing Master Pipelines List; string id = viewing Detail Stage Editor
  const [editingPipelineId, setEditingPipelineId] = useState(null);

  // Sub-tabs inside Pipeline Configure sidebar: 'source' | 'stages'
  const [configureSubTab, setConfigureSubTab] = useState('stages');

  const [stages, setStages] = useState([]);
  const [initialStages, setInitialStages] = useState([]);
  const [allLeads, setAllLeads] = useState([]);
  const [connectedForms, setConnectedForms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Detail view state
  const [newStageName, setNewStageName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [isChangingForm, setIsChangingForm] = useState(false);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2800);
  };

  // Reset form changing state on pipeline or tab change
  useEffect(() => {
    setIsChangingForm(false);
  }, [editingPipelineId, configureSubTab]);

  // Sync renameValue when switching pipeline
  useEffect(() => {
    if (activePipeline?.name) {
      setRenameValue(activePipeline.name);
    }
  }, [editingPipelineId]);

  // Sync configure state with parent to collapse admin subnav
  useEffect(() => {
    onConfigureStateChange?.(editingPipelineId !== null);
  }, [editingPipelineId, onConfigureStateChange]);

  // Fetch initial pipelines, leads, and forms
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      try {
        const [pipeRes, leadsRes, formsRes] = await Promise.all([
          supabase.from('pipelines').select('*').order('is_default', { ascending: false }),
          supabase.from('leads').select('id, stage, pipeline_id'),
          supabase.from('connected_forms').select('*')
        ]);

        if (pipeRes.error) throw pipeRes.error;

        if (isMounted && pipeRes.data && pipeRes.data.length > 0) {
          setPipelines(pipeRes.data);
          try {
            localStorage.setItem('crm_cached_pipelines', JSON.stringify(pipeRes.data));
          } catch (e) { }
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
    return () => { isMounted = false; };
  }, []);

  const isDirty = JSON.stringify(stages) !== JSON.stringify(initialStages);

  // Active editing pipeline object
  const activePipeline = pipelines.find(p => p.id === editingPipelineId);
  const attachedForm = connectedForms.find(f => f.pipeline_id === editingPipelineId);

  // Active pipeline leads
  const activePipelineLeads = allLeads.filter(
    (l) => l.pipeline_id === editingPipelineId || (!l.pipeline_id && activePipeline?.is_default)
  );

  const leadCounts = {};
  activePipelineLeads.forEach((l) => {
    const st = l.stage || 'new';
    leadCounts[st] = (leadCounts[st] || 0) + 1;
  });

  // Open a pipeline for stage editing
  const handleOpenConfigure = (pipe, initialTab = 'stages') => {
    setEditingPipelineId(pipe.id);
    setConfigureSubTab(initialTab);
    setRenameValue(pipe.name || '');
    const pipeStages = pipe.stages || [];
    setStages(pipeStages);
    setInitialStages(pipeStages);
  };

  // Back to master list
  const handleBackToList = () => {
    if (isDirty) {
      if (!window.confirm('Discard unsaved stage changes and return to pipelines list?')) {
        return;
      }
    }
    setEditingPipelineId(null);
    setStages([]);
    setInitialStages([]);
  };

  // Create new pipeline
  const handleCreatePipeline = async () => {
    const name = window.prompt('Enter new pipeline name:');
    if (!name || !name.trim()) return;

    const starterStages = [
      { id: 'new', label: 'New Leads', order: 0, is_entry: true },
      { id: 'contacted', label: 'Contacted', order: 1, is_entry: false },
      { id: 'proposal', label: 'Proposal Sent', order: 2, is_entry: false },
      { id: 'won', label: 'Won', order: 3, is_entry: false },
      { id: 'lost', label: 'Lost', order: 4, is_entry: false }
    ];

    try {
      const { data: newPipe, error } = await supabase
        .from('pipelines')
        .insert([{
          name: name.trim(),
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

      handleOpenConfigure(newPipe, 'stages');
      showToast(`Created pipeline "${name.trim()}"`);
    } catch (err) {
      console.error('Error creating pipeline:', err);
      showToast('Failed to create pipeline.');
    }
  };

  // Rename pipeline
  const handleRenameSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === activePipeline?.name) {
      if (activePipeline?.name) setRenameValue(activePipeline.name);
      return;
    }

    try {
      const { error } = await supabase
        .from('pipelines')
        .update({ name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', editingPipelineId);

      if (error) throw error;

      setPipelines(prev => prev.map(p => p.id === editingPipelineId ? { ...p, name: trimmed } : p));
      showToast('Pipeline renamed.');
    } catch (err) {
      console.error('Error renaming pipeline:', err);
      showToast('Failed to rename pipeline.');
    }
  };

  // Delete pipeline
  const handleDeletePipeline = async (pipeToDelete, e) => {
    if (e) e.stopPropagation();

    if (pipelines.length <= 1) {
      alert('You must have at least one pipeline in your CRM.');
      return;
    }

    const pLeads = allLeads.filter(l => l.pipeline_id === pipeToDelete.id || (!l.pipeline_id && pipeToDelete.is_default));
    const otherPipes = pipelines.filter(p => p.id !== pipeToDelete.id);
    const targetFallbackPipe = otherPipes.find(p => p.is_default) || otherPipes[0];

    const confirmMsg = pLeads.length > 0
      ? `Delete pipeline "${pipeToDelete.name}"? ${pLeads.length} lead(s) will be transferred to "${targetFallbackPipe.name}".`
      : `Delete pipeline "${pipeToDelete.name}"?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      if (pipeToDelete.is_default && targetFallbackPipe) {
        await supabase
          .from('pipelines')
          .update({ is_default: true })
          .eq('id', targetFallbackPipe.id);
      }

      if (pLeads.length > 0 && targetFallbackPipe) {
        await supabase
          .from('leads')
          .update({ pipeline_id: targetFallbackPipe.id })
          .eq('pipeline_id', pipeToDelete.id);
      }

      await supabase
        .from('connected_forms')
        .update({ pipeline_id: targetFallbackPipe?.id || null })
        .eq('pipeline_id', pipeToDelete.id);

      const { error } = await supabase.from('pipelines').delete().eq('id', pipeToDelete.id);
      if (error) throw error;

      const remaining = pipelines
        .filter(p => p.id !== pipeToDelete.id)
        .map(p => pipeToDelete.is_default && p.id === targetFallbackPipe.id ? { ...p, is_default: true } : p);

      setPipelines(remaining);

      if (editingPipelineId === pipeToDelete.id) {
        setEditingPipelineId(null);
        setStages([]);
        setInitialStages([]);
      }

      showToast(`Pipeline deleted.${pLeads.length > 0 ? ` Leads moved to "${targetFallbackPipe.name}".` : ''}`);
    } catch (err) {
      console.error('Error deleting pipeline:', err);
      showToast('Failed to delete pipeline.');
    }
  };

  // Form association
  const handleFormChange = async (formId) => {
    try {
      if (attachedForm) {
        await supabase
          .from('connected_forms')
          .update({ pipeline_id: null })
          .eq('form_id', attachedForm.form_id);
      }

      if (formId) {
        await supabase
          .from('connected_forms')
          .update({ pipeline_id: editingPipelineId })
          .eq('form_id', formId);
      }

      const { data: updatedForms } = await supabase.from('connected_forms').select('*');
      if (updatedForms) {
        setConnectedForms(updatedForms);
      }

      showToast(formId ? 'Meta form linked.' : 'Meta form unlinked.');
    } catch (err) {
      console.error('Error updating form:', err);
      showToast('Failed to update form attachment.');
    }
  };

  // Stage Manipulation
  const handleLabelChange = (index, newLabel) => {
    setStages(prev => prev.map((st, i) => i === index ? { ...st, label: newLabel } : st));
  };

  const handleSetEntryStage = (stageId) => {
    setStages(prev => prev.map(st => ({
      ...st,
      is_entry: st.id === stageId
    })));
  };

  const stageItemRefs = useRef(new Map());
  const prevRects = useRef(new Map());

  const captureStagePositions = () => {
    const map = new Map();
    stageItemRefs.current.forEach((el, id) => {
      if (el) {
        map.set(id, el.getBoundingClientRect());
      }
    });
    prevRects.current = map;
  };

  useLayoutEffect(() => {
    if (prevRects.current.size === 0) return;

    stageItemRefs.current.forEach((el, id) => {
      if (!el) return;
      const prevRect = prevRects.current.get(id);
      if (!prevRect) return;

      const newRect = el.getBoundingClientRect();
      const deltaY = prevRect.top - newRect.top;

      if (deltaY !== 0) {
        el.style.transform = `translateY(${deltaY}px)`;
        el.style.transition = 'none';

        requestAnimationFrame(() => {
          el.style.transition = 'transform 240ms cubic-bezier(0.2, 0, 0, 1)';
          el.style.transform = '';
        });
      }
    });

    prevRects.current.clear();
  }, [stages]);

  const handleMoveUp = (index) => {
    if (index === 0) return;
    captureStagePositions();
    setStages(prev => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const handleMoveDown = (index) => {
    if (index === stages.length - 1) return;
    captureStagePositions();
    setStages(prev => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const handleAddStage = (e) => {
    e.preventDefault();
    const label = newStageName.trim();
    if (!label) return;

    const newId = `stage_${Date.now()}`;
    const newStage = {
      id: newId,
      label,
      order: stages.length,
      is_entry: stages.length === 0
    };

    setStages(prev => [...prev, newStage]);
    setNewStageName('');
  };

  const handleDeleteStage = async (index) => {
    const stageToDelete = stages[index];
    if (stageToDelete.is_entry) {
      alert('The Entry Stage cannot be deleted. Designate another stage as Entry Stage first.');
      return;
    }
    if (stages.length <= 2) {
      alert('A pipeline requires at least 2 stages.');
      return;
    }

    const count = leadCounts[stageToDelete.id] || 0;
    const entryStage = stages.find(s => s.is_entry) || stages[0];

    const confirmMsg = count > 0
      ? `Delete "${stageToDelete.label}"? ${count} lead(s) will be moved to "${entryStage.label}".`
      : `Delete "${stageToDelete.label}"?`;

    if (!window.confirm(confirmMsg)) return;

    if (count > 0 && entryStage) {
      try {
        await supabase
          .from('leads')
          .update({ stage: entryStage.id })
          .eq('stage', stageToDelete.id);

        setAllLeads(prev => prev.map(l => l.stage === stageToDelete.id ? { ...l, stage: entryStage.id } : l));
      } catch (err) {
        console.error('Error migrating leads on delete:', err);
      }
    }

    setStages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!editingPipelineId) return;
    setIsSaving(true);

    try {
      const normalizedStages = stages.map((st, idx) => ({
        id: st.id,
        label: st.label,
        order: idx,
        is_entry: Boolean(st.is_entry)
      }));

      const { error } = await supabase
        .from('pipelines')
        .update({
          stages: normalizedStages,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingPipelineId);

      if (error) throw error;

      setInitialStages(normalizedStages);
      setPipelines(prev => prev.map(p => p.id === editingPipelineId ? { ...p, stages: normalizedStages } : p));

      if (activePipeline?.is_default) {
        try {
          localStorage.setItem('crm_pipeline_columns', JSON.stringify(normalizedStages));
        } catch (e) { }
      }

      showToast('Changes saved.');
    } catch (err) {
      console.error('Error saving stages:', err);
      showToast('Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="pipeline-view-container">
        <div className="pipeline-view-inner">
          <Skeleton width="100%" height="36px" borderRadius="6px" />
          <Skeleton width="100%" height="280px" borderRadius="8px" />
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
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>
            Access Restricted
          </h2>
          <p style={{ fontSize: '13px', color: '#64748b' }}>
            You do not have permission to view or manage pipelines.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pipeline-view-container">
      {/* ==============================================================
          STATE A: MASTER VIEW (NO STAGES DIRECTLY SHOWN ON OPEN)
          ============================================================== */}
      {editingPipelineId === null ? (
        <div className="pipeline-view-inner">
          <div className="pipeline-master-header">
            <div className="pipeline-master-title-group">
              <h1 className="pipeline-master-title">Pipelines</h1>
              <span className="pipeline-master-count">{pipelines.length}</span>
            </div>

            {canEdit && (
              <button
                type="button"
                className="btn-minimal-save"
                onClick={handleCreatePipeline}
              >
                <Plus size={15} strokeWidth={2} />
                <span>New Pipeline</span>
              </button>
            )}
          </div>

          <div className="pipeline-cards-list">
            {pipelines.map((pipe) => {
              const pipeStages = Array.isArray(pipe.stages) ? pipe.stages : [];
              const pipeLeads = allLeads.filter(l => l.pipeline_id === pipe.id || (!l.pipeline_id && pipe.is_default));
              const form = connectedForms.find(f => f.pipeline_id === pipe.id);

              return (
                <div
                  key={pipe.id}
                  className="pipeline-card-row"
                  onClick={() => handleOpenConfigure(pipe)}
                >
                  <div className="pipeline-card-main">
                    <h3 className="pipeline-card-title">{pipe.name}</h3>
                    <div className="pipeline-card-meta">
                      <span>{pipeStages.length} {pipeStages.length === 1 ? 'stage' : 'stages'}</span>
                      <span className="pipeline-card-dot">·</span>
                      <span>{pipeLeads.length} {pipeLeads.length === 1 ? 'lead' : 'leads'}</span>
                      {form && (
                        <>
                          <span className="pipeline-card-dot">·</span>
                          <span className="pipeline-card-form">
                            {form.form_name || `Form ${form.form_id}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pipeline-card-actions">
                    <button
                      type="button"
                      className="btn-card-configure"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenConfigure(pipe);
                      }}
                    >
                      <span>Configure</span>
                      <ArrowRight size={14} strokeWidth={2} />
                    </button>

                    {canDelete && (
                      <button
                        type="button"
                        className="btn-card-delete"
                        disabled={pipelines.length <= 1}
                        onClick={(e) => handleDeletePipeline(pipe, e)}
                        title={pipelines.length <= 1 ? 'Minimum 1 pipeline required' : 'Delete pipeline'}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ==============================================================
           STATE B: CONFIGURE SPLIT LAYOUT (COLLAPSED ADMIN SUBNAV + DEDICATED PIPELINE SUBNAV)
           ============================================================== */
        <div className="pipeline-config-layout">
          {/* Left Contextual Pipeline Sidebar */}
          <div className="pipeline-config-subnav">
            <div className="pipeline-config-identity">
              <div className="pipeline-config-title-row">
                <h2 className="pipeline-config-title" title={activePipeline?.name}>
                  {activePipeline?.name}
                </h2>
              </div>
            </div>

            {/* Pipeline Configure Tabs List */}
            <ul className="pipeline-config-nav-list">
              <li>
                <button
                  type="button"
                  className={`pipeline-config-nav-btn ${configureSubTab === 'general' ? 'active' : ''}`}
                  onClick={() => setConfigureSubTab('general')}
                >
                  <Sliders size={20} strokeWidth={1.75} />
                  <span>General</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`pipeline-config-nav-btn ${configureSubTab === 'stages' ? 'active' : ''}`}
                  onClick={() => setConfigureSubTab('stages')}
                >
                  <GitFork size={20} strokeWidth={1.75} />
                  <span>Stages</span>
                </button>
              </li>
            </ul>

            {/* Bottom Back Button */}
            <div className="pipeline-config-bottom-back">
              <button
                type="button"
                className="pipeline-config-nav-btn pipeline-config-back-btn"
                onClick={handleBackToList}
                title="Return to Pipelines overview"
              >
                <ArrowLeft size={20} strokeWidth={1.75} />
                <span>All Pipelines</span>
              </button>
            </div>
          </div>

          {/* Right Content Workspace Pane */}
          <div className="pipeline-config-content">
            {/* Fixed Top-Right Actions (only applicable to Stages tab) */}
            {configureSubTab === 'stages' && (
              <div className="pipeline-content-actions-fixed">
                {canEdit && isDirty && (
                  <button
                    type="button"
                    className="btn-minimal"
                    onClick={() => setStages(initialStages)}
                    disabled={isSaving}
                  >
                    <RotateCcw size={12} />
                    <span>Discard</span>
                  </button>
                )}

                {canEdit && (
                  <button
                    type="button"
                    className="btn-minimal-save"
                    onClick={handleSave}
                    disabled={isSaving || !isDirty}
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw size={12} className="spin-icon" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        {isDirty && <span className="unsaved-dot" />}
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* TAB 1: GENERAL CONTENT */}
            {configureSubTab === 'general' && (
              <div className="pipeline-general-wrap">
                {/* 1. Pipeline Name Section */}
                <div className="pipeline-general-section">
                  <label className="pipeline-general-label">Pipeline Name</label>
                  <form onSubmit={handleRenameSubmit} className="pipeline-name-row">
                    <input
                      type="text"
                      className="pipeline-name-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRenameSubmit}
                      placeholder="e.g. Sales Pipeline"
                      readOnly={!canEdit}
                    />
                  </form>
                </div>

                {/* 2. Lead Source Section */}
                <div className="pipeline-general-section">
                  <label className="pipeline-general-label">Lead Source</label>

                  {attachedForm ? (
                    <div className="pipeline-source-row">
                      <div className="pipeline-source-info">
                        <span className="pipeline-source-name">{attachedForm.form_name || `Form ${attachedForm.form_id}`}</span>
                        <div className="pipeline-source-subtext">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="#1877F2" style={{ flexShrink: 0 }}>
                            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                          </svg>
                          <span>ID: {attachedForm.form_id}</span>
                        </div>
                      </div>

                      {canEdit && (
                        <div className="pipeline-source-actions">
                          {isChangingForm ? (
                            <>
                              <select
                                className="pipeline-source-select-clean"
                                value=""
                                autoFocus
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleFormChange(e.target.value);
                                    setIsChangingForm(false);
                                  }
                                }}
                              >
                                <option value="">Choose new form...</option>
                                {connectedForms
                                  .filter(f => f.form_id !== attachedForm.form_id)
                                  .map(f => {
                                    const otherPipe = f.pipeline_id && f.pipeline_id !== editingPipelineId
                                      ? pipelines.find(p => p.id === f.pipeline_id)
                                      : null;
                                    return (
                                      <option key={f.form_id} value={f.form_id}>
                                        {f.form_name || `Form ${f.form_id}`} {otherPipe ? `(on: ${otherPipe.name})` : ''}
                                      </option>
                                    );
                                  })}
                              </select>
                              <button
                                type="button"
                                className="btn-source-cancel"
                                onClick={() => setIsChangingForm(false)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-source-change"
                                onClick={() => setIsChangingForm(true)}
                              >
                                Change
                              </button>
                              <button
                                type="button"
                                className="btn-source-action-icon"
                                onClick={() => handleFormChange(null)}
                                data-tooltip="Disconnect form"
                                data-tooltip-pos="right-edge"
                                aria-label="Disconnect form"
                              >
                                <Unlink size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="pipeline-source-row">
                      <div className="pipeline-source-info">
                        <span className="pipeline-source-name">No Form Connected</span>
                        <div className="pipeline-source-subtext">
                          Select a Meta Lead form to start auto-routing leads.
                        </div>
                      </div>

                      {canEdit && (
                        <div className="pipeline-source-actions">
                          <select
                            className="pipeline-source-select-clean"
                            value=""
                            onChange={(e) => handleFormChange(e.target.value || null)}
                          >
                            <option value="">Select a form...</option>
                            {connectedForms.map(f => {
                              const otherPipe = f.pipeline_id && f.pipeline_id !== editingPipelineId
                                ? pipelines.find(p => p.id === f.pipeline_id)
                                : null;
                              return (
                                <option key={f.form_id} value={f.form_id}>
                                  {f.form_name || `Form ${f.form_id}`} {otherPipe ? `(currently on: ${otherPipe.name})` : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: STAGES CONTENT */}
            {configureSubTab === 'stages' && (
              <div className="pipeline-numbered-list-wrap">
                {stages.map((st, idx) => {
                  const isEntry = Boolean(st.is_entry);

                  return (
                    <div
                      key={st.id}
                      ref={(el) => {
                        if (el) {
                          stageItemRefs.current.set(st.id, el);
                        } else {
                          stageItemRefs.current.delete(st.id);
                        }
                      }}
                      className="pipeline-numbered-item"
                    >
                      <div className="pipeline-numbered-left">
                        <span className="pipeline-number-index">{idx + 1}</span>
                        <input
                          type="text"
                          className="pipeline-number-input"
                          value={st.label}
                          onChange={(e) => handleLabelChange(idx, e.target.value)}
                          readOnly={!canEdit}
                        />
                      </div>

                      <div className="pipeline-numbered-actions">
                        {isEntry ? (
                          <span
                            className="btn-entry-icon active"
                            data-tooltip="Entry Stage: All new incoming leads land here"
                          >
                            <ArrowDownLeft size={17} strokeWidth={2.25} />
                          </span>
                        ) : (
                          canEdit && (
                            <button
                              type="button"
                              className="btn-entry-icon"
                              onClick={() => handleSetEntryStage(st.id)}
                              data-tooltip="Set as Entry Stage for incoming leads"
                            >
                              <ArrowDownLeft size={17} strokeWidth={2.25} />
                            </button>
                          )
                        )}

                        <div className="pipeline-arrows-group">
                          <button
                            type="button"
                            className="btn-arrow-standalone"
                            disabled={!canEdit || idx === 0}
                            onClick={() => handleMoveUp(idx)}
                          >
                            <ChevronUp size={18} strokeWidth={2.25} />
                          </button>
                          <button
                            type="button"
                            className="btn-arrow-standalone"
                            disabled={!canEdit || idx === stages.length - 1}
                            onClick={() => handleMoveDown(idx)}
                          >
                            <ChevronDown size={18} strokeWidth={2.25} />
                          </button>
                        </div>

                        {canDelete && (
                          <button
                            type="button"
                            className="btn-number-trash"
                            disabled={isEntry || stages.length <= 2}
                            onClick={() => handleDeleteStage(idx)}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Minimal Inline Add Stage Next Row */}
                {canEdit && (
                  <form onSubmit={handleAddStage} className="pipeline-numbered-item pipeline-add-row-minimal">
                    <div className="pipeline-numbered-left">
                      <span className="pipeline-number-index pipeline-number-index-ghost">
                        {stages.length + 1}
                      </span>
                      <input
                        type="text"
                        className="pipeline-number-input pipeline-add-input-minimal"
                        placeholder="Add a stage..."
                        value={newStageName}
                        onChange={(e) => setNewStageName(e.target.value)}
                      />
                    </div>

                    {newStageName.trim() && (
                      <div className="pipeline-numbered-actions">
                        <button type="submit" className="btn-add-minimal-pill">
                          Add
                        </button>
                      </div>
                    )}
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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
