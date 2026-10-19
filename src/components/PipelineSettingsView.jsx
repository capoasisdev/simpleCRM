import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Check,
  RotateCcw,
  RefreshCw,
  ShieldAlert,
  Plus,
  Minus,
  ArrowLeft,
  ArrowRight,
  Edit2,
  Link2,
  GitFork,
  FileText,
  CheckCircle2,
  ArrowDownLeft,
  Unlink,
  Sliders,
  Users,
  Zap,
  MessageCircle,
  Mail
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission } from '../lib/permissions';
import { fetchEmailTemplates } from '../lib/email';
import Skeleton from './common/Skeleton';
import CustomSelect from './common/CustomSelect';
import '../styles/pipeline.css';

const DIST_MODE_OPTIONS = [
  { value: 'round_robin', label: 'Round-Robin', sublabel: '(Sequential Rotation)' },
  { value: 'weighted', label: 'Weighted Ratio', sublabel: '(Proportional by Weight)' },
  { value: 'single', label: 'Single Representative', sublabel: '(100% to One Rep)' },
  { value: 'unassigned', label: 'Unassigned Backlog', sublabel: '(Manual Claim)' }
];

const MONO_SHADES = ['#0f172a', '#64748b', '#94a3b8', '#334155', '#cbd5e1'];

const getInitials = (name) => {
  if (!name) return 'U';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
};

const formatFormName = (f) => {
  if (!f) return 'Lead Form';
  let name = (f.form_name || '').trim();
  if (name.toLowerCase().startsWith('id:')) {
    name = name.replace(/^id:\s*/i, '').trim();
  }
  if (!name || /^\d{6,}$/.test(name)) {
    return 'Lead Form';
  }
  return name;
};

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

  // Sub-tabs inside Pipeline Configure sidebar: 'general' | 'stages' | 'distribution'
  const [configureSubTab, setConfigureSubTab] = useState('stages');

  const [stages, setStages] = useState([]);
  const [initialStages, setInitialStages] = useState([]);
  const [allLeads, setAllLeads] = useState([]);
  const [connectedForms, setConnectedForms] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [globalRoutingConfig, setGlobalRoutingConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Distribution tab states
  const [distMode, setDistMode] = useState('round_robin'); // 'round_robin' | 'weighted' | 'single' | 'unassigned'
  const [distAssignee, setDistAssignee] = useState('');
  const [distRules, setDistRules] = useState([]);
  const [initialDist, setInitialDist] = useState(null);
  const [isSavingDist, setIsSavingDist] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const weightDebounceTimer = useRef(null);
  const saveStatusTimer = useRef(null);

  // Stage Automations states
  const [stageAutomations, setStageAutomations] = useState([]);
  const [waTemplates, setWaTemplates] = useState([]);
  const [emailTemplates, setEmailTemplates] = useState([]);

  const triggerSavedFeedback = () => {
    setSaveStatus('saved');
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
    saveStatusTimer.current = setTimeout(() => setSaveStatus(null), 2000);
  };

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

  // Fetch initial pipelines, leads, forms, users, routing config, and whatsapp templates
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      try {
        const [pipeRes, leadsRes, formsRes, usersRes, routeRes, metaRes] = await Promise.all([
          supabase.from('pipelines').select('*').order('is_default', { ascending: false }),
          supabase.from('leads').select('id, stage, pipeline_id'),
          supabase.from('connected_forms').select('*'),
          supabase.from('crm_users').select('id, name, email, role').order('name', { ascending: true }),
          supabase.from('lead_routing_config').select('*').limit(1).maybeSingle(),
          supabase.from('meta_config').select('whatsapp_templates').limit(1).maybeSingle()
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

        if (isMounted && usersRes.data) {
          setUsersList(usersRes.data);
        }

        if (isMounted && routeRes.data) {
          setGlobalRoutingConfig(routeRes.data);
        }

        if (isMounted && metaRes.data?.whatsapp_templates && Array.isArray(metaRes.data.whatsapp_templates)) {
          // Include approved templates or all synced templates
          const approved = metaRes.data.whatsapp_templates.filter(t => !t.status || t.status === 'APPROVED');
          setWaTemplates(approved.length > 0 ? approved : metaRes.data.whatsapp_templates);
        }

        try {
          const emailTmpls = await fetchEmailTemplates();
          if (isMounted && Array.isArray(emailTmpls)) {
            setEmailTemplates(emailTmpls);
          }
        } catch (e) {
          console.warn('Could not load email templates:', e);
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

  // Distribution dirty state
  const isDistDirty = useMemo(() => {
    if (!initialDist) return false;
    if (distMode !== initialDist.mode) return true;
    if (distAssignee !== initialDist.default_assignee) return true;
    return JSON.stringify(distRules) !== JSON.stringify(initialDist.user_rules);
  }, [distMode, distAssignee, distRules, initialDist]);

  const activeDistMembers = useMemo(() => {
    return distRules.filter(r => r.enabled !== false);
  }, [distRules]);

  const totalDistWeight = useMemo(() => {
    return activeDistMembers.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  }, [activeDistMembers]);

  const calculateMemberShare = (member) => {
    if (!member.enabled) return 0;
    if (distMode === 'round_robin') {
      return activeDistMembers.length > 0 ? Math.round(100 / activeDistMembers.length) : 0;
    }
    if (distMode === 'weighted') {
      if (totalDistWeight === 0) return 0;
      return Math.round(((Number(member.weight) || 0) / totalDistWeight) * 100);
    }
    return 0;
  };

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

  // Open a pipeline for stage & distribution editing
  const handleOpenConfigure = (pipe, initialTab = 'stages') => {
    setEditingPipelineId(pipe.id);
    setConfigureSubTab(initialTab);
    setRenameValue(pipe.name || '');
    const pipeStages = pipe.stages || [];
    setStages(pipeStages);
    setInitialStages(pipeStages);
    setStageAutomations(Array.isArray(pipe.stage_automations) ? pipe.stage_automations : []);

    fetchEmailTemplates().then(tmpls => {
      if (Array.isArray(tmpls)) setEmailTemplates(tmpls);
    }).catch(() => {});

    // Initialize pipeline-scoped distribution
    const defaultRoster = (usersList.length > 0 ? usersList : [
      { id: '1', name: 'Pranav Patil', email: 'pranav.p@capoasis.com', role: 'admin' },
      { id: '2', name: 'Nikita Sonawane', email: 'nikita.s@salado.in', role: 'member' }
    ]).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      enabled: true,
      weight: 50
    }));

    const pipeDist = pipe.lead_distribution;
    let finalMode = 'round_robin';
    let finalAssignee = defaultRoster[0]?.name || 'Pranav Patil';
    let finalRules = defaultRoster;

    if (pipeDist && typeof pipeDist === 'object') {
      finalMode = pipeDist.mode || 'round_robin';
      finalAssignee = pipeDist.default_assignee || finalAssignee;
      if (Array.isArray(pipeDist.user_rules) && pipeDist.user_rules.length > 0) {
        finalRules = defaultRoster.map(u => {
          const existing = pipeDist.user_rules.find(r => r.id === u.id || r.email === u.email || r.name === u.name);
          return existing ? { ...u, enabled: existing.enabled !== false, weight: existing.weight ?? 50 } : u;
        });
      }
    } else if (globalRoutingConfig) {
      finalMode = globalRoutingConfig.mode || 'round_robin';
      finalAssignee = globalRoutingConfig.default_assignee || finalAssignee;
      if (Array.isArray(globalRoutingConfig.user_rules) && globalRoutingConfig.user_rules.length > 0) {
        finalRules = defaultRoster.map(u => {
          const existing = globalRoutingConfig.user_rules.find(r => r.id === u.id || r.email === u.email || r.name === u.name);
          return existing ? { ...u, enabled: existing.enabled !== false, weight: existing.weight ?? 50 } : u;
        });
      }
    }

    // Normalize active weights so they cleanly sum to 100%
    const activeR = finalRules.filter(r => r.enabled !== false);
    const sumW = activeR.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
    if (activeR.length > 0 && sumW !== 100) {
      const eq = Math.floor(100 / activeR.length);
      const rem = 100 - (eq * activeR.length);
      finalRules = finalRules.map(r => {
        if (r.enabled === false) return r;
        const aIdx = activeR.findIndex(a => a.id === r.id);
        return { ...r, weight: eq + (aIdx === 0 ? rem : 0) };
      });
    }

    const distObj = {
      mode: finalMode,
      default_assignee: finalAssignee,
      user_rules: finalRules
    };

    setDistMode(finalMode);
    setDistAssignee(finalAssignee);
    setDistRules(finalRules);
    setInitialDist(distObj);
  };

  const handleMemberToggle = (id, checked) => {
    let updated = distRules.map(r => r.id === id ? { ...r, enabled: checked } : r);
    const active = updated.filter(r => r.enabled !== false);
    if (active.length > 0) {
      const equalShare = Math.floor(100 / active.length);
      const remainder = 100 - (equalShare * active.length);
      updated = updated.map(r => {
        if (r.enabled === false) return r;
        const activeIdx = active.findIndex(a => a.id === r.id);
        const w = equalShare + (activeIdx === 0 ? remainder : 0);
        return { ...r, weight: w };
      });
    }
    setDistRules(updated);
    saveDistributionPayload({ user_rules: updated });
  };

  const handleStepWeight = (id, delta) => {
    const currentMember = distRules.find(r => r.id === id);
    if (!currentMember) return;
    const currentVal = Number(currentMember.weight) || 0;
    const nextVal = Math.max(0, Math.min(100, currentVal + delta));
    handleMemberWeightChange(id, nextVal);
  };

  const handleMemberWeightChange = (id, val) => {
    const rawNum = val === '' ? 0 : Number(val);
    const targetPct = Math.max(0, Math.min(100, isNaN(rawNum) ? 0 : rawNum));

    const otherActives = distRules.filter(r => r.enabled !== false && r.id !== id);

    let updated;
    if (otherActives.length === 0) {
      updated = distRules.map(r => r.id === id ? { ...r, weight: 100 } : r);
    } else if (otherActives.length === 1) {
      const otherId = otherActives[0].id;
      const otherWeight = Math.max(0, 100 - targetPct);
      updated = distRules.map(r => {
        if (r.id === id) return { ...r, weight: targetPct };
        if (r.id === otherId) return { ...r, weight: otherWeight };
        return r;
      });
    } else {
      const rem = Math.max(0, 100 - targetPct);
      const currentOtherSum = otherActives.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);

      let allocated = 0;
      const newWeightsMap = {};
      otherActives.forEach((member, i) => {
        if (i === otherActives.length - 1) {
          newWeightsMap[member.id] = Math.max(0, rem - allocated);
        } else {
          let share;
          if (currentOtherSum === 0) {
            share = Math.round(rem / otherActives.length);
          } else {
            share = Math.round((rem * (Number(member.weight) || 0)) / currentOtherSum);
          }
          newWeightsMap[member.id] = Math.max(0, share);
          allocated += newWeightsMap[member.id];
        }
      });

      updated = distRules.map(r => {
        if (r.id === id) return { ...r, weight: targetPct };
        if (newWeightsMap[r.id] !== undefined) return { ...r, weight: newWeightsMap[r.id] };
        return r;
      });
    }

    setDistRules(updated);
    if (weightDebounceTimer.current) clearTimeout(weightDebounceTimer.current);
    weightDebounceTimer.current = setTimeout(() => {
      saveDistributionPayload({ user_rules: updated });
    }, 500);
  };

  const handleWeightBlur = () => {
    if (weightDebounceTimer.current) clearTimeout(weightDebounceTimer.current);
    saveDistributionPayload({ user_rules: distRules });
  };

  const saveDistributionPayload = async (overrides = {}) => {
    if (!editingPipelineId) return;
    setIsSavingDist(true);
    try {
      const payload = {
        mode: overrides.mode ?? distMode,
        default_assignee: overrides.default_assignee ?? distAssignee,
        user_rules: overrides.user_rules ?? distRules,
        round_robin_index: activePipeline?.lead_distribution?.round_robin_index || 0
      };

      const { error } = await supabase
        .from('pipelines')
        .update({
          lead_distribution: payload,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingPipelineId);

      if (error) {
        console.error('Error saving distribution:', error);
        showToast(error.message?.includes('column') ? 'Please run migration in Supabase SQL editor' : 'Error saving distribution');
      } else {
        const updated = pipelines.map(p => p.id === editingPipelineId ? { ...p, lead_distribution: payload } : p);
        setPipelines(updated);
        try {
          localStorage.setItem('crm_cached_pipelines', JSON.stringify(updated));
        } catch (e) { }
        setInitialDist(payload);
        triggerSavedFeedback();
      }
    } catch (err) {
      console.error('Save distribution error:', err);
      showToast('Failed to save distribution');
    } finally {
      setIsSavingDist(false);
    }
  };

  const handleModeChange = (newMode) => {
    setDistMode(newMode);
    saveDistributionPayload({ mode: newMode });
  };

  const handleAssigneeChange = (newAssignee) => {
    setDistAssignee(newAssignee);
    saveDistributionPayload({ default_assignee: newAssignee });
  };

  // Stage Automations save & toggle handlers
  const saveStageAutomations = async (updatedAutomations) => {
    if (!editingPipelineId) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('pipelines')
        .update({
          stage_automations: updatedAutomations,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingPipelineId);

      if (error) {
        console.error('Error saving stage automations:', error);
        showToast(error.message?.includes('column') ? 'Please run migration in Supabase SQL editor' : 'Error saving automations');
      } else {
        const updated = pipelines.map(p => p.id === editingPipelineId ? { ...p, stage_automations: updatedAutomations } : p);
        setPipelines(updated);
        try {
          localStorage.setItem('crm_cached_pipelines', JSON.stringify(updated));
        } catch (e) { }
        triggerSavedFeedback();
      }
    } catch (err) {
      console.error('Save automations error:', err);
      showToast('Failed to save automations');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStageAutomation = (stageId, checked) => {
    let exists = false;
    let updated = stageAutomations.map(a => {
      if (a.stage_id === stageId) {
        exists = true;
        const defaultTmpl = a.template_name || (waTemplates[0]?.name || 'salado_lead_welcome');
        return { ...a, is_active: checked, template_name: defaultTmpl };
      }
      return a;
    });

    if (!exists) {
      const defaultTmpl = waTemplates[0]?.name || 'salado_lead_welcome';
      updated.push({
        stage_id: stageId,
        is_active: checked,
        template_name: defaultTmpl
      });
    }

    setStageAutomations(updated);
    saveStageAutomations(updated);
  };

  const handleSelectStageTemplate = (stageId, templateName) => {
    let exists = false;
    let updated = stageAutomations.map(a => {
      if (a.stage_id === stageId) {
        exists = true;
        return { ...a, template_name: templateName };
      }
      return a;
    });

    if (!exists) {
      updated.push({
        stage_id: stageId,
        is_active: true,
        template_name: templateName
      });
    }

    setStageAutomations(updated);
    saveStageAutomations(updated);
  };

  const handleToggleEmailAutomation = (stageId, checked) => {
    let exists = false;
    let updated = stageAutomations.map(a => {
      if (a.stage_id === stageId) {
        exists = true;
        const defaultTmplId = a.email_template_id || (emailTemplates[0]?.id || '');
        return { ...a, email_active: checked, email_template_id: defaultTmplId };
      }
      return a;
    });

    if (!exists) {
      const defaultTmplId = emailTemplates[0]?.id || '';
      updated.push({
        stage_id: stageId,
        is_active: false,
        template_name: '',
        email_active: checked,
        email_template_id: defaultTmplId
      });
    }

    setStageAutomations(updated);
    saveStageAutomations(updated);
  };

  const handleSelectEmailTemplate = (stageId, templateId) => {
    let exists = false;
    let updated = stageAutomations.map(a => {
      if (a.stage_id === stageId) {
        exists = true;
        return { ...a, email_template_id: templateId };
      }
      return a;
    });

    if (!exists) {
      updated.push({
        stage_id: stageId,
        is_active: false,
        template_name: '',
        email_active: true,
        email_template_id: templateId
      });
    }

    setStageAutomations(updated);
    saveStageAutomations(updated);
  };

  // Back to master list
  const handleBackToList = () => {
    setEditingPipelineId(null);
    setStages([]);
    setInitialStages([]);
    setInitialDist(null);
    setStageAutomations([]);
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

  // Stage Manipulation & Auto-Save
  const saveStagesList = async (stagesList) => {
    if (!editingPipelineId) return;
    setIsSaving(true);

    try {
      const normalizedStages = stagesList.map((st, idx) => ({
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

      triggerSavedFeedback();
    } catch (err) {
      console.error('Error saving stages:', err);
      showToast('Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLabelChange = (index, newLabel) => {
    setStages(prev => prev.map((st, i) => i === index ? { ...st, label: newLabel } : st));
  };

  const handleSetEntryStage = (stageId) => {
    const updated = stages.map(st => ({
      ...st,
      is_entry: st.id === stageId
    }));
    setStages(updated);
    saveStagesList(updated);
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
    const copy = [...stages];
    const temp = copy[index - 1];
    copy[index - 1] = copy[index];
    copy[index] = temp;
    setStages(copy);
    saveStagesList(copy);
  };

  const handleMoveDown = (index) => {
    if (index === stages.length - 1) return;
    captureStagePositions();
    const copy = [...stages];
    const temp = copy[index + 1];
    copy[index + 1] = copy[index];
    copy[index] = temp;
    setStages(copy);
    saveStagesList(copy);
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

    const nextStages = [...stages, newStage];
    setStages(nextStages);
    setNewStageName('');
    saveStagesList(nextStages);
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

    const nextStages = stages.filter((_, i) => i !== index);
    setStages(nextStages);
    saveStagesList(nextStages);
  };

  if (isLoading) {
    return (
      <div className="pipeline-view-container">
        <div className="pipeline-view-inner">
          <div className="pipeline-master-header">
            <div className="pipeline-master-title-group">
              <h1 className="pipeline-master-title">Pipelines</h1>
              <span className="pipeline-master-count" style={{ minWidth: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Skeleton width="18px" height="14px" borderRadius="4px" />
              </span>
            </div>

            <Skeleton width="115px" height="32px" borderRadius="6px" />
          </div>

          <div className="pipeline-cards-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="pipeline-card-row" style={{ cursor: 'default', pointerEvents: 'none' }}>
                <div className="pipeline-card-main">
                  <Skeleton width={i === 1 ? '190px' : i === 2 ? '230px' : '160px'} height="17px" borderRadius="4px" />
                  <div className="pipeline-card-meta" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Skeleton width="55px" height="12px" borderRadius="3px" />
                    <span className="pipeline-card-dot" style={{ opacity: 0.4 }}>·</span>
                    <Skeleton width="48px" height="12px" borderRadius="3px" />
                  </div>
                </div>

                <div className="pipeline-card-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Skeleton width="110px" height="28px" borderRadius="6px" />
                </div>
              </div>
            ))}
          </div>
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
              <li>
                <button
                  type="button"
                  className={`pipeline-config-nav-btn ${configureSubTab === 'distribution' ? 'active' : ''}`}
                  onClick={() => setConfigureSubTab('distribution')}
                >
                  <Users size={20} strokeWidth={1.75} />
                  <span>Distribution</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`pipeline-config-nav-btn ${configureSubTab === 'automations' ? 'active' : ''}`}
                  onClick={() => setConfigureSubTab('automations')}
                >
                  <Zap size={20} strokeWidth={1.75} />
                  <span>Automations</span>
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
            {/* Auto-save status indicator in header */}
            <div className="pipeline-content-actions-fixed">
              {(isSaving || isSavingDist) ? (
                <div className="pipeline-autosave-indicator saving">
                  <RefreshCw size={12} className="spin-icon" />
                  <span>Saving...</span>
                </div>
              ) : saveStatus === 'saved' ? (
                <div className="pipeline-autosave-indicator saved">
                  <Check size={12} strokeWidth={2.5} />
                  <span>Saved</span>
                </div>
              ) : null}
            </div>

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
                        <span className="pipeline-source-name">{formatFormName(attachedForm)}</span>
                        <div className="pipeline-source-subtext">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="#1877F2" style={{ flexShrink: 0 }}>
                            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                          </svg>
                          <span>Meta Instant Form</span>
                        </div>
                      </div>

                      {canEdit && (
                        <div className="pipeline-source-actions">
                          {isChangingForm ? (
                            <>
                              <CustomSelect
                                className="pipeline-source-custom-select"
                                value=""
                                onChange={(val) => {
                                  if (val) {
                                    handleFormChange(val);
                                    setIsChangingForm(false);
                                  }
                                }}
                                placeholder="Choose new form..."
                                options={connectedForms
                                  .filter(f => f.form_id !== attachedForm.form_id)
                                  .map(f => ({
                                    value: f.form_id,
                                    label: formatFormName(f)
                                  }))}
                              />
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
                          <CustomSelect
                            className="pipeline-source-custom-select"
                            value=""
                            onChange={(val) => handleFormChange(val || null)}
                            placeholder="Select a form..."
                            options={connectedForms.map(f => ({
                              value: f.form_id,
                              label: formatFormName(f)
                            }))}
                          />
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
                <div className="pipeline-general-header-between" style={{ marginBottom: 8 }}>
                  <label className="pipeline-general-label" style={{ marginBottom: 0 }}>
                    Pipeline Stages
                  </label>
                  <span className="pipeline-dist-count-badge">
                    {stages.length} {stages.length === 1 ? 'stage' : 'stages'}
                  </span>
                </div>
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
                          onBlur={() => saveStagesList(stages)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.target.blur();
                          }}
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

            {/* TAB 3: DISTRIBUTION CONTENT (Minimalist Style Matching General) */}
            {configureSubTab === 'distribution' && (
              <div className="pipeline-general-wrap">
                {/* 1. Distribution Mode Section */}
                <div className="pipeline-general-section">
                  <label className="pipeline-general-label">Distribution Mode</label>

                  <div className="pipeline-name-row" style={{ maxWidth: 440 }}>
                    <CustomSelect
                      value={distMode}
                      onChange={handleModeChange}
                      options={DIST_MODE_OPTIONS}
                    />
                  </div>
                </div>

                {/* 2. Single Representative Section */}
                {distMode === 'single' && (
                  <div className="pipeline-general-section">
                    <label className="pipeline-general-label">Assigned Representative</label>

                    <div className="pipeline-name-row" style={{ maxWidth: 440 }}>
                      <CustomSelect
                        value={distAssignee}
                        onChange={handleAssigneeChange}
                        placeholder="Select representative..."
                        options={distRules.map((u) => ({
                          value: u.name,
                          label: u.name,
                          sublabel: u.email || u.role || ''
                        }))}
                      />
                    </div>
                  </div>
                )}

                {/* 3. Team Rotation Section (for Round-Robin or Weighted) */}
                {(distMode === 'round_robin' || distMode === 'weighted') && (
                  <div className="pipeline-general-section">
                    <div className="pipeline-general-header-between">
                      <label className="pipeline-general-label" style={{ marginBottom: 0 }}>
                        {distMode === 'weighted' ? 'Capacity & Weight Allocation' : 'Active Representatives'}
                      </label>
                      <span className="pipeline-dist-count-badge">
                        {activeDistMembers.length} of {distRules.length} active
                      </span>
                    </div>

                    {/* Top Full-Width Thick Multi-Segment Track (Round-Robin & Weighted modes) */}
                    {(distMode === 'round_robin' || distMode === 'weighted') && activeDistMembers.length > 0 && (
                      <div className="pipeline-dist-top-allocation">
                        <div className="pipeline-dist-multi-bar">
                          {activeDistMembers.map((member, aIdx) => {
                            const pct = calculateMemberShare(member);
                            if (pct <= 0) return null;
                            const color = MONO_SHADES[aIdx % MONO_SHADES.length];
                            return (
                              <div
                                key={member.id}
                                className="pipeline-dist-bar-segment"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: color
                                }}
                                title={`${member.name}: ${pct}%`}
                              >
                                <span className="pipeline-dist-segment-name">{member.name}</span>
                                <span className="pipeline-dist-segment-pct">{pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Stages-Style Numbered Team Roster */}
                    <div className="pipeline-dist-numbered-wrap">
                      {distRules.map((member, idx) => {
                        const percent = calculateMemberShare(member);
                        const isEnabled = member.enabled !== false;

                        return (
                          <div
                            key={member.id}
                            className={`pipeline-dist-numbered-item ${!isEnabled ? 'is-disabled' : ''}`}
                          >
                            <div className="pipeline-dist-numbered-left">
                              <span className="pipeline-number-index">{idx + 1}</span>
                              <div className="pipeline-dist-user-details">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span className="pipeline-dist-user-name">{member.name}</span>
                                  {member.role === 'admin' && (
                                    <span className="pipeline-dist-user-role">ADMIN</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="pipeline-dist-numbered-actions">
                              {distMode === 'weighted' && isEnabled && (
                                <div className="pipeline-dist-weight-dock">
                                  <button
                                    type="button"
                                    className="btn-dist-step-action minus"
                                    onClick={() => handleStepWeight(member.id, -5)}
                                    disabled={percent <= 0}
                                    title="Decrease share (-5%)"
                                    aria-label={`Decrease share for ${member.name}`}
                                  >
                                    <Minus size={14} strokeWidth={2.25} />
                                  </button>

                                  <div className="pipeline-dist-pct-slot">
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      className="pipeline-dist-pct-bare-input"
                                      value={percent}
                                      onChange={(e) => handleMemberWeightChange(member.id, e.target.value)}
                                      onBlur={handleWeightBlur}
                                      title="Percentage share"
                                    />
                                    <span className="pipeline-dist-pct-bare-suffix">%</span>
                                  </div>

                                  <button
                                    type="button"
                                    className="btn-dist-step-action plus"
                                    onClick={() => handleStepWeight(member.id, 5)}
                                    disabled={percent >= 100}
                                    title="Increase share (+5%)"
                                    aria-label={`Increase share for ${member.name}`}
                                  >
                                    <Plus size={14} strokeWidth={2.25} />
                                  </button>
                                </div>
                              )}

                              {distMode === 'round_robin' && isEnabled && (
                                <div className="pipeline-dist-weight-dock static">
                                  <span className="pipeline-dist-rr-share">
                                    {percent}%
                                  </span>
                                </div>
                              )}

                              <button
                                type="button"
                                className={`btn-dist-entry-toggle ${isEnabled ? 'active' : ''}`}
                                onClick={() => handleMemberToggle(member.id, !isEnabled)}
                                data-tooltip={isEnabled ? 'Active in rotation (click to pause)' : 'Paused (click to activate)'}
                                data-tooltip-pos="right-edge"
                                aria-label={isEnabled ? `Pause ${member.name}` : `Activate ${member.name}`}
                              >
                                <Check size={18} strokeWidth={2.5} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 4. Fallback Assignee */}
                {(distMode === 'round_robin' || distMode === 'weighted') && (
                  <div className="pipeline-general-section">
                    <label className="pipeline-general-label">Fallback Assignee</label>

                    <div className="pipeline-name-row" style={{ maxWidth: 440 }}>
                      <CustomSelect
                        value={distAssignee}
                        onChange={handleAssigneeChange}
                        placeholder="Select fallback representative..."
                        options={distRules.map((u) => ({
                          value: u.name,
                          label: u.name,
                          sublabel: u.email || u.role || ''
                        }))}
                      />
                    </div>
                  </div>
                )}

                {/* 5. Unassigned Note */}
                {distMode === 'unassigned' && (
                  <div className="pipeline-general-section">
                    <div className="pipeline-source-row" style={{ background: '#f8fafc' }}>
                      <div className="pipeline-source-info">
                        <span className="pipeline-source-name" style={{ color: '#334155' }}>Unassigned Backlog</span>
                        <div className="pipeline-source-subtext">
                          Incoming leads will enter this pipeline without an assigned representative. Any team member can view and manually claim them.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: AUTOMATIONS CONTENT (Multi-Channel Style) */}
            {configureSubTab === 'automations' && (
              <div className="pipeline-numbered-list-wrap">
                <div className="pipeline-general-header-between" style={{ marginBottom: 12 }}>
                  <label className="pipeline-general-label" style={{ marginBottom: 0 }}>
                    Stage Automations
                  </label>
                  <span className="pipeline-dist-count-badge">
                    {stageAutomations.filter(a => a.is_active || a.email_active).length} of {stages.length} stages active
                  </span>
                </div>

                <div className="pipeline-dist-numbered-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {stages.map((st, idx) => {
                    const auto = stageAutomations.find(a => a.stage_id === st.id) || {
                      stage_id: st.id,
                      is_active: false,
                      template_name: '',
                      email_active: false,
                      email_template_id: ''
                    };
                    const isWaActive = !!auto.is_active;
                    const isEmailActive = !!auto.email_active;
                    const isAnyActive = isWaActive || isEmailActive;

                    return (
                      <div
                        key={st.id}
                        className={`pipeline-auto-card ${isAnyActive ? 'is-active' : ''}`}
                      >
                        {/* Header: Index, Stage name, active channel badges */}
                        <div className="pipeline-auto-card-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="pipeline-number-index">{idx + 1}</span>
                            <span className="pipeline-auto-stage-name">{st.label}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isWaActive && (
                              <span className="pipeline-auto-badge-pill" style={{ background: '#dcfce7', color: '#166534' }}>
                                <MessageCircle size={11} /> WhatsApp
                              </span>
                            )}
                            {isEmailActive && (
                              <span className="pipeline-auto-badge-pill" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                                <Mail size={11} /> Email
                              </span>
                            )}
                            {!isAnyActive && (
                              <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>No automations</span>
                            )}
                          </div>
                        </div>

                        {/* WhatsApp Channel Row */}
                        <div className="pipeline-auto-channel-row">
                          <div className="pipeline-auto-channel-info">
                            <div className="pipeline-auto-channel-icon" style={{ background: '#dcfce7' }}>
                              <MessageCircle size={14} color="#166534" />
                            </div>
                            <span className="pipeline-auto-channel-name">WhatsApp</span>
                          </div>

                          <div className="pipeline-auto-channel-controls">
                            {isWaActive ? (
                              <div className="pipeline-auto-select-container">
                                {waTemplates.length === 0 ? (
                                  <span className="stage-auto-no-templates-pill" title="Connect WABA in Settings → Integrations">
                                    No templates synced
                                  </span>
                                ) : (
                                  <CustomSelect
                                    value={auto.template_name || ''}
                                    onChange={(val) => handleSelectStageTemplate(st.id, val)}
                                    placeholder="Select WhatsApp template..."
                                    options={waTemplates.map(t => ({
                                      value: t.name,
                                      label: t.name
                                    }))}
                                  />
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: '12.5px', color: '#94a3b8' }}>Disabled</span>
                            )}

                            <button
                              type="button"
                              className={`btn-auto-rectangular-toggle ${isWaActive ? 'active' : ''}`}
                              onClick={() => handleToggleStageAutomation(st.id, !isWaActive)}
                              disabled={!canEdit}
                              data-tooltip={isWaActive ? 'WhatsApp Active (click to pause)' : 'WhatsApp Paused (click to activate)'}
                              data-tooltip-pos="right-edge"
                              aria-label={isWaActive ? `Pause WhatsApp for ${st.label}` : `Activate WhatsApp for ${st.label}`}
                            >
                              <Check size={18} strokeWidth={2.5} />
                            </button>
                          </div>
                        </div>

                        {/* Email Channel Row */}
                        <div className="pipeline-auto-channel-row">
                          <div className="pipeline-auto-channel-info">
                            <div className="pipeline-auto-channel-icon" style={{ background: '#e0f2fe' }}>
                              <Mail size={14} color="#0369a1" />
                            </div>
                            <span className="pipeline-auto-channel-name">Email (Resend)</span>
                          </div>

                          <div className="pipeline-auto-channel-controls">
                            {isEmailActive ? (
                              <div className="pipeline-auto-select-container">
                                {emailTemplates.length === 0 ? (
                                  <span className="stage-auto-no-templates-pill" style={{ background: '#f0f9ff', borderColor: '#bae6fd', color: '#0369a1' }} title="Create templates in Settings → Integrations → Email">
                                    No email templates
                                  </span>
                                ) : (
                                  <CustomSelect
                                    value={auto.email_template_id || ''}
                                    onChange={(val) => handleSelectEmailTemplate(st.id, val)}
                                    placeholder="Select email template..."
                                    options={emailTemplates.map(t => ({
                                      value: t.id,
                                      label: t.name
                                    }))}
                                  />
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: '12.5px', color: '#94a3b8' }}>Disabled</span>
                            )}

                            <button
                              type="button"
                              className={`btn-auto-rectangular-toggle ${isEmailActive ? 'email-active' : ''}`}
                              onClick={() => handleToggleEmailAutomation(st.id, !isEmailActive)}
                              disabled={!canEdit}
                              data-tooltip={isEmailActive ? 'Email Active (click to pause)' : 'Email Paused (click to activate)'}
                              data-tooltip-pos="right-edge"
                              aria-label={isEmailActive ? `Pause Email for ${st.label}` : `Activate Email for ${st.label}`}
                            >
                              <Check size={18} strokeWidth={2.5} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
