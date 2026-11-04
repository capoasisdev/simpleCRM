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
  XCircle,
  ArrowDownLeft,
  Unlink,
  Sliders,
  Users,
  Zap,
  MessageCircle,
  Mail,
  Globe,
  ListFilter,
  CreditCard,
  Pin,
  Info,
  Monitor,
  Compass,
  Sparkles,
  Play,
  Search,
  ShieldCheck,
  AlertCircle,
  Clock,
  Building2,
  UserCheck,
  MessageSquare,
  HelpCircle,
  Radio,
  AtSign,
  Target,
  Layers,
  LayoutGrid,
  MapPin,
  User,
  Briefcase,
  X,
  Calendar,
  Radar,
  Brain
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hasPermission } from '../lib/permissions';
import { fetchEmailTemplates } from '../lib/email';
import { getPipelineFields, DEFAULT_PIPELINE_FIELDS, DEFAULT_COLD_PIPELINE_FIELDS, labelToKey, extractPipelineFormQuestions } from '../lib/pipelineFields';
import { runColdDiscoveryBatch, calculateNextDiscoveryRun, formatNextRunDate, hasDiscoveryTargetingCriteria } from '../lib/coldDiscoveryScraper';
import { DEFAULT_DEDUPE_RULES } from '../lib/coldDeduplication';
import Skeleton from './common/Skeleton';
import CustomSelect from './common/CustomSelect';
import { META_CAPI_EVENTS } from '../lib/metaCapi';
import { generatePipelineConfigFromPrompt } from '../lib/pipelineAiGenerator';
import '../styles/pipeline.css';

const DEFAULT_DISCOVERY_CONFIG = {
  enabled: true,
  target_mode: 'b2b', // 'b2b' | 'b2c'
  autopilot_enabled: false,
  schedule_cadence: 'weekdays', // 'weekdays' | 'daily' | 'twice_daily' | 'weekly'
  schedule_time: '09:00',
  sources: ['linkedin', 'web_discovery'], // multi-source array
  source: 'linkedin', // 'linkedin' | 'web_discovery' | 'google_places' | 'instagram' | 'clutch' | 'webhook'
  target_countries: [],
  target_regions: [],
  target_industries: [],
  target_company_sizes: [],
  target_roles: [],
  target_personas: [],
  target_interests: [],
  search_queries: [],
  target_locations: [],
  search_query: '',
  location: '',
  industry: '',
  webhook_url: '',
  google_maps_api_key: '',
  batch_size: 25,
  dedupe: DEFAULT_DEDUPE_RULES,
  next_run_at: null,
  last_run_at: null,
  last_run_stats: null
};

export const B2B_DISCOVERY_SOURCES = [
  {
    id: 'linkedin',
    name: 'LinkedIn Profiles',
    tag: 'B2B Executives & Decision Makers',
    icon: Users
  },
  {
    id: 'web_discovery',
    name: 'Corporate Websites',
    tag: 'Official Sites & SaaS Platforms',
    icon: Globe
  },
  {
    id: 'clutch',
    name: 'Clutch & Directories',
    tag: 'Verified Agencies & Tech Consultancies',
    icon: ShieldCheck
  },
  {
    id: 'google_places',
    name: 'Google Maps & Local',
    tag: 'Offices, Shops & Commercial Centers',
    icon: Compass
  },
  {
    id: 'webhook',
    name: 'Custom Webhook API',
    tag: 'Apify, PhantomBuster & Custom Scripts',
    icon: Link2
  }
];

export const B2C_DISCOVERY_SOURCES = [
  {
    id: 'reddit',
    name: 'Reddit Communities',
    tag: 'Active Advice-Seekers & Buying Inquiries',
    icon: MessageSquare
  },
  {
    id: 'quora',
    name: 'Quora Q&A Threads',
    tag: 'Consumer Questions & Comparisons',
    icon: HelpCircle
  },
  {
    id: 'instagram',
    name: 'Instagram Handles',
    tag: 'Lifestyle Profiles & Engaged Commenters',
    icon: AtSign
  },
  {
    id: 'web_discovery',
    name: 'Consumer Forums & Reviews',
    tag: 'Regional Discussion Boards & Reviews',
    icon: Globe
  },
  {
    id: 'webhook',
    name: 'Social Intent Webhook',
    tag: 'F5Bot & Real-Time Keyword Alerts',
    icon: Radio
  }
];

export const DISCOVERY_SOURCES = [...B2B_DISCOVERY_SOURCES, ...B2C_DISCOVERY_SOURCES.filter(s => s.id === 'reddit' || s.id === 'quora' || s.id === 'instagram')];

const getSourceShortName = (source) => {
  if (!source) return '';
  if (source.id === 'reddit') return 'Reddit';
  if (source.id === 'quora') return 'Quora';
  if (source.id === 'instagram') return 'Instagram';
  if (source.id === 'linkedin') return 'LinkedIn';
  if (source.id === 'web_discovery') return 'Forums & Reviews';
  if (source.id === 'clutch') return 'Clutch';
  if (source.id === 'google_places') return 'Google Maps';
  if (source.id === 'webhook') return 'Webhook';
  return source.name;
};

const COMPANY_SIZE_OPTIONS = ['1–10', '11–50', '51–200', '201–500', '500+'];

const getDiscoveryArray = (config, arrayKey, legacyKey) => {
  if (Array.isArray(config?.[arrayKey]) && config[arrayKey].length > 0) {
    return config[arrayKey];
  }
  if (arrayKey === 'target_regions' && Array.isArray(config?.target_locations) && config.target_locations.length > 0) {
    return config.target_locations;
  }
  if (typeof config?.[legacyKey] === 'string' && config[legacyKey].trim()) {
    return [config[legacyKey].trim()];
  }
  return [];
};

const DISCOVERY_CADENCE_OPTIONS = [
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'daily', label: 'Daily (Every day)' },
  { value: 'twice_daily', label: 'Twice Daily (Morning & Afternoon)' },
  { value: 'weekly', label: 'Weekly (Mondays)' }
];

const DISCOVERY_BATCH_OPTIONS = [
  { value: 10, label: '10 prospects' },
  { value: 15, label: '15 prospects' },
  { value: 25, label: '25 prospects' },
  { value: 50, label: '50 prospects' }
];

const DUPLICATE_ACTION_OPTIONS = [
  { value: 'skip', label: 'Skip Duplicate' },
  { value: 'enrich', label: 'Enrich Existing Card' }
];



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

function CommaSeparatedCellInput({ value = [], onChange, placeholder, disabled, className = "pipeline-linear-input" }) {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.join(', ') : ''));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(Array.isArray(value) ? value.join(', ') : '');
    }
  }, [value, isFocused]);

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = text
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const deduped = [...new Set(parsed)];
    setText(deduped.join(', '));
    onChange(deduped);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  return (
    <input
      type="text"
      className={className}
      value={text}
      onFocus={() => setIsFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={disabled}
    />
  );
}

function PillArrayInput({ value = [], onChange, placeholder = "+ add...", disabled }) {
  const [inputText, setInputText] = useState('');
  const inputRef = useRef(null);

  const items = useMemo(() => (Array.isArray(value) ? value : []), [value]);

  const addItems = (text) => {
    if (!text.trim()) return;
    const newItems = text
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const merged = [...new Set([...items, ...newItems])];
    onChange(merged);
    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addItems(inputText);
    } else if (e.key === 'Backspace' && !inputText && items.length > 0 && !disabled) {
      e.preventDefault();
      const next = items.slice(0, -1);
      onChange(next);
    }
  };

  const handleBlur = () => {
    if (inputText.trim()) {
      addItems(inputText);
    }
  };

  const handleRemove = (itemToRemove) => {
    if (disabled) return;
    const next = items.filter(it => it !== itemToRemove);
    onChange(next);
  };

  return (
    <div
      className="pipeline-prop-pills-wrap"
      onClick={() => {
        if (!disabled && inputRef.current) {
          inputRef.current.focus();
        }
      }}
    >
      {items.map((item) => (
        <span key={item} className="pipeline-prop-pill">
          <span>{item}</span>
          {!disabled && (
            <button
              type="button"
              className="pipeline-prop-pill-remove"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(item);
              }}
              title={`Remove ${item}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          ref={inputRef}
          type="text"
          className="pipeline-prop-pill-add-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={items.length === 0 ? placeholder : '+ add...'}
        />
      )}
    </div>
  );
}

export default function PipelineSettingsView({ currentUser, onConfigureStateChange, pipelineType = 'sales' }) {
  const canView = hasPermission(currentUser, 'pipeline', 'view');
  const canEdit = hasPermission(currentUser, 'pipeline', 'edit');
  const canDelete = hasPermission(currentUser, 'pipeline', 'delete');

  const cacheKey = pipelineType === 'cold' ? 'crm_cached_pipelines_cold' : 'crm_cached_pipelines';

  const [pipelines, setPipelines] = useState(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
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

  // Pipeline Custom Properties states
  const [pipelineProperties, setPipelineProperties] = useState([]);
  // Pipeline Fields (Lead information & Card mapping)
  const [pipelineFields, setPipelineFields] = useState([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldMappedQuestion, setNewFieldMappedQuestion] = useState('');
  const [openSelectFieldKey, setOpenSelectFieldKey] = useState(null);

  // Discovery & Scraping Engine states (Cold Pipelines)
  const [discoveryConfig, setDiscoveryConfig] = useState(DEFAULT_DISCOVERY_CONFIG);
  const [initialDiscoveryConfig, setInitialDiscoveryConfig] = useState(null);
  const [isSavingDiscovery, setIsSavingDiscovery] = useState(false);
  const [isRunningDiscovery, setIsRunningDiscovery] = useState(false);
  const [discoveryRunModal, setDiscoveryRunModal] = useState(null);
  const [newCountryInput, setNewCountryInput] = useState('');
  const [newRegionInput, setNewRegionInput] = useState('');
  const [newIndustryInput, setNewIndustryInput] = useState('');
  const [newPersonaInput, setNewPersonaInput] = useState('');
  const [newInterestInput, setNewInterestInput] = useState('');
  const [newLocationInput, setNewLocationInput] = useState('');
  const [newQueryInput, setNewQueryInput] = useState('');
  const [newTargetRoleInput, setNewTargetRoleInput] = useState('');
  const [aiPromptInput, setAiPromptInput] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiPromptFeedback, setAiPromptFeedback] = useState('');
  const discoveryDebounceTimer = useRef(null);

  const hasTargetingCriteria = useMemo(() => {
    const hasPendingInput =
      Boolean(newCountryInput.trim()) ||
      Boolean(newRegionInput.trim()) ||
      Boolean(newQueryInput.trim()) ||
      (discoveryConfig?.target_mode === 'b2c'
        ? Boolean(newPersonaInput.trim()) || Boolean(newInterestInput.trim())
        : Boolean(newIndustryInput.trim()) || Boolean(newTargetRoleInput.trim())
      );
    return hasDiscoveryTargetingCriteria(discoveryConfig) || hasPendingInput;
  }, [discoveryConfig, newCountryInput, newRegionInput, newQueryInput, newPersonaInput, newInterestInput, newIndustryInput, newTargetRoleInput]);

  const triggerSavedFeedback = () => {
    setSaveStatus('saved');
    if (saveStatusTimer.current) clearTimeout(saveStatusTimer.current);
    saveStatusTimer.current = setTimeout(() => setSaveStatus(null), 2000);
  };

  // Detail view state
  const [newStageName, setNewStageName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [isChangingForm, setIsChangingForm] = useState(false);
  const [isPipelineDropdownOpen, setIsPipelineDropdownOpen] = useState(false);
  const pipelineDropdownRef = useRef(null);
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false);
  const channelsDropdownRef = useRef(null);

  // Close channels dropdown on outside click
  useEffect(() => {
    if (!isChannelDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (channelsDropdownRef.current && !channelsDropdownRef.current.contains(e.target)) {
        setIsChannelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isChannelDropdownOpen]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2800);
  };

  // Close pipeline switcher dropdown on outside click or Escape
  useEffect(() => {
    if (!isPipelineDropdownOpen) return;

    const handleClickOutside = (e) => {
      if (pipelineDropdownRef.current && !pipelineDropdownRef.current.contains(e.target)) {
        setIsPipelineDropdownOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsPipelineDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPipelineDropdownOpen]);

  // Active editing pipeline object
  const activePipeline = pipelines.find(p => p.id === editingPipelineId);
  const attachedForm = pipelineType === 'sales'
    ? connectedForms.find(f => f.pipeline_id === editingPipelineId)
    : null;

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

  // Sync pipeline fields when activePipeline changes
  useEffect(() => {
    if (activePipeline) {
      setPipelineFields(getPipelineFields(activePipeline, pipelineType));
    } else {
      setPipelineFields(pipelineType === 'cold' ? DEFAULT_COLD_PIPELINE_FIELDS : DEFAULT_PIPELINE_FIELDS);
    }
  }, [activePipeline, pipelineType]);



  // Fetch initial pipelines, leads, forms, users, routing config, and whatsapp templates
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      try {
        const [pipeRes, leadsRes, formsRes, usersRes, routeRes, metaRes] = await Promise.all([
          supabase.from('pipelines').select('*').order('is_default', { ascending: false }),
          supabase.from('leads').select('id, stage, pipeline_id, form_id, form_name, custom_fields'),
          supabase.from('connected_forms').select('*'),
          supabase.from('crm_users').select('id, name, email, role').order('name', { ascending: true }),
          supabase.from('lead_routing_config').select('*').limit(1).maybeSingle(),
          supabase.from('meta_config').select('whatsapp_templates').limit(1).maybeSingle()
        ]);

        if (pipeRes.error) throw pipeRes.error;

        const matchesType = (p) => {
          if (pipelineType === 'cold') {
            return p.pipeline_type === 'cold';
          }
          return !p.pipeline_type || p.pipeline_type === 'sales';
        };

        if (isMounted) {
          const filtered = Array.isArray(pipeRes.data) ? pipeRes.data.filter(matchesType) : [];
          setPipelines(filtered);
          try {
            localStorage.setItem(cacheKey, JSON.stringify(filtered));
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

    setEditingPipelineId(null);
    setStages([]);
    setInitialStages([]);
    if (onConfigureStateChange) onConfigureStateChange(false);

    loadData();
    return () => { isMounted = false; };
  }, [pipelineType, cacheKey]);

  // Listen for pipeline creation from AI Assistant (FAB Chatbot)
  useEffect(() => {
    const handlePipelineCreated = (event) => {
      const newPipe = event?.detail?.pipeline || event?.detail;
      if (!newPipe || !newPipe.id) return;
      const isCold = newPipe.pipeline_type === 'cold';
      if ((pipelineType === 'cold' && isCold) || (pipelineType === 'sales' && !isCold)) {
        setPipelines(prev => {
          if (prev.some(p => p.id === newPipe.id)) return prev;
          const updated = [newPipe, ...prev];
          try {
            localStorage.setItem(cacheKey, JSON.stringify(updated));
          } catch (e) {}
          return updated;
        });
        handleOpenConfigure(newPipe, 'general');
        showToast(`✨ Opened newly created AI pipeline: "${newPipe.name}"`);
      }
    };

    window.addEventListener('crm:pipeline_created', handlePipelineCreated);
    return () => window.removeEventListener('crm:pipeline_created', handlePipelineCreated);
  }, [pipelineType, cacheKey]);

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

  // Active pipeline leads strictly scoped to this pipeline and its attached form (if sales)
  const activePipelineLeads = useMemo(() => {
    if (!editingPipelineId) return [];
    return allLeads.filter((l) => {
      if (pipelineType === 'cold') {
        return l.pipeline_id === editingPipelineId;
      }

      // 1. If this pipeline has a connected form, leads from that form strictly belong here
      if (attachedForm) {
        if (l.form_id && l.form_id === attachedForm.form_id) return true;
        if (l.form_name && attachedForm.form_name && l.form_name.toLowerCase().trim() === attachedForm.form_name.toLowerCase().trim()) return true;
      }

      // 2. Direct pipeline_id match, excluding any lead belonging to another attached form
      if (l.pipeline_id === editingPipelineId) {
        if (l.form_id) {
          const otherForm = connectedForms.find(f => f.pipeline_id && f.pipeline_id !== editingPipelineId && f.form_id === l.form_id);
          if (otherForm) return false;
        }
        return true;
      }

      // 3. Unassigned leads for default pipeline
      if (!l.pipeline_id && activePipeline?.is_default) {
        if (l.form_id) {
          const otherForm = connectedForms.find(f => f.pipeline_id && f.pipeline_id !== editingPipelineId && f.form_id === l.form_id);
          if (otherForm) return false;
        }
        return true;
      }

      return false;
    });
  }, [allLeads, editingPipelineId, attachedForm, connectedForms, activePipeline, pipelineType]);

  const availableFormQuestions = useMemo(() => {
    return extractPipelineFormQuestions(activePipelineLeads);
  }, [activePipelineLeads]);

  const getFieldMappingOptions = (field) => {
    const opts = [];
    if (field.key === 'name') opts.push({ value: 'name', label: 'Form: Full Name' });
    if (field.key === 'phone') opts.push({ value: 'phone', label: 'Form: Phone Number' });
    if (field.key === 'email') opts.push({ value: 'email', label: 'Form: Email Address' });

    // Deduplicated list of available questions from connected forms
    availableFormQuestions.forEach((q) => {
      if (!opts.some((o) => o.value.toLowerCase() === q.toLowerCase())) {
        opts.push({ value: q, label: q });
      }
    });

    // If city is not already present as a form question, offer standard Form: City
    if (field.key === 'city' && !opts.some((o) => o.value.toLowerCase() === 'city')) {
      opts.push({ value: 'city', label: 'Form: City' });
    }

    if (!field.is_core && field.mapped_question && !opts.some((o) => o.value === field.mapped_question)) {
      opts.push({ value: field.mapped_question, label: field.mapped_question });
    }

    if (!opts.some((o) => o.value.toLowerCase() === field.key.toLowerCase())) {
      opts.push({ value: field.key, label: `Custom Key (${field.key})` });
    }
    return opts;
  };

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
    }).catch(() => { });

    // Initialize pipeline-scoped distribution
    // All users in the company are strictly OPT-IN per pipeline.
    // A user is ONLY active if explicitly saved with enabled: true in user_rules.
    const allUsersRoster = (usersList.length > 0 ? usersList : [
      { id: '1', name: 'Pranav Patil', email: 'pranav.p@capoasis.com', role: 'admin' },
      { id: '2', name: 'Nikita Sonawane', email: 'nikita.s@salado.in', role: 'member' }
    ]).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      enabled: false,
      weight: 0
    }));

    const pipeDist = pipe.lead_distribution;
    let finalMode = 'round_robin';
    let finalAssignee = allUsersRoster[0]?.name || 'Nikita Sonawane';
    let finalRules = allUsersRoster;

    if (pipeDist && typeof pipeDist === 'object') {
      finalMode = pipeDist.mode || 'round_robin';
      finalAssignee = pipeDist.default_assignee || finalAssignee;
      const savedRules = Array.isArray(pipeDist.user_rules) ? pipeDist.user_rules : [];

      if (savedRules.length > 0) {
        finalRules = allUsersRoster.map(u => {
          const existing = savedRules.find(r => r.id === u.id || r.email === u.email || r.name === u.name);
          if (existing) {
            return {
              ...u,
              enabled: existing.enabled === true,
              weight: existing.weight ?? (existing.enabled === true ? 50 : 0)
            };
          }
          // User was never added to this pipeline -> strictly disabled
          return { ...u, enabled: false, weight: 0 };
        });
      }
    } else if (globalRoutingConfig) {
      finalMode = globalRoutingConfig.mode || 'round_robin';
      finalAssignee = globalRoutingConfig.default_assignee || finalAssignee;
      const savedRules = Array.isArray(globalRoutingConfig.user_rules) ? globalRoutingConfig.user_rules : [];

      if (savedRules.length > 0) {
        finalRules = allUsersRoster.map(u => {
          const existing = savedRules.find(r => r.id === u.id || r.email === u.email || r.name === u.name);
          if (existing) {
            return {
              ...u,
              enabled: existing.enabled === true,
              weight: existing.weight ?? (existing.enabled === true ? 50 : 0)
            };
          }
          return { ...u, enabled: false, weight: 0 };
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
        if (r.enabled === false) return { ...r, weight: 0 };
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

    // Initialize discovery configuration for cold pipelines
    const pipeDiscovery = pipe.discovery_config && typeof pipe.discovery_config === 'object'
      ? { ...DEFAULT_DISCOVERY_CONFIG, ...pipe.discovery_config, dedupe: { ...DEFAULT_DISCOVERY_CONFIG.dedupe, ...(pipe.discovery_config.dedupe || {}) } }
      : DEFAULT_DISCOVERY_CONFIG;

    if (Array.isArray(pipeDiscovery.target_roles) &&
        pipeDiscovery.target_roles.length === 4 &&
        pipeDiscovery.target_roles[0] === 'Founder' &&
        pipeDiscovery.target_roles[1] === 'Managing Director') {
      pipeDiscovery.target_roles = [];
    }

    setDiscoveryConfig(pipeDiscovery);
    setInitialDiscoveryConfig(pipeDiscovery);
  };

  const handleMemberToggle = (id, checked) => {
    let updated = distRules.map(r => r.id === id ? { ...r, enabled: checked } : r);
    const active = updated.filter(r => r.enabled !== false);
    if (active.length > 0) {
      const equalShare = Math.floor(100 / active.length);
      const remainder = 100 - (equalShare * active.length);
      updated = updated.map(r => {
        if (r.enabled === false) return { ...r, weight: 0 };
        const activeIdx = active.findIndex(a => a.id === r.id);
        const w = equalShare + (activeIdx === 0 ? remainder : 0);
        return { ...r, weight: w };
      });
    } else {
      updated = updated.map(r => ({ ...r, weight: 0 }));
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
          localStorage.setItem(cacheKey, JSON.stringify(updated));
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

  // Discovery & Scraping Engine save & runner handlers
  const saveDiscoveryPayload = async (overrides = {}) => {
    if (!editingPipelineId) return;
    setIsSavingDiscovery(true);
    try {
      const payload = {
        ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
        ...overrides,
        dedupe: {
          ...((discoveryConfig || DEFAULT_DISCOVERY_CONFIG).dedupe || {}),
          ...(overrides.dedupe || {})
        }
      };

      const { error } = await supabase
        .from('pipelines')
        .update({
          discovery_config: payload,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingPipelineId);

      if (error) {
        console.error('Error saving discovery config:', error);
        showToast(error.message?.includes('column') ? 'Please run migration in Supabase SQL editor' : 'Error saving discovery configuration');
      } else {
        const updated = pipelines.map(p => p.id === editingPipelineId ? { ...p, discovery_config: payload } : p);
        setPipelines(updated);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(updated));
        } catch (e) { }
        setInitialDiscoveryConfig(payload);
        triggerSavedFeedback();
      }
    } catch (err) {
      console.error('Network error saving discovery config:', err);
    } finally {
      setIsSavingDiscovery(false);
    }
  };

  // Updates local discovery state without triggering network calls while typing
  const handleDiscoveryTextChange = (field, value) => {
    setDiscoveryConfig(prev => ({
      ...(prev || DEFAULT_DISCOVERY_CONFIG),
      [field]: value
    }));
  };

  // Commits to Supabase only on blur or Enter
  const handleDiscoveryBlur = () => {
    saveDiscoveryPayload(discoveryConfig);
  };

  // Immediate save for single-click dropdowns
  const handleDiscoverySelectChange = (field, value) => {
    setDiscoveryConfig(prev => {
      const next = { ...(prev || DEFAULT_DISCOVERY_CONFIG), [field]: value };
      saveDiscoveryPayload(next);
      return next;
    });
  };

  const handleDiscoveryArrayChange = (arrayKey, legacyKey, newArray) => {
    setDiscoveryConfig(prev => {
      const next = {
        ...(prev || DEFAULT_DISCOVERY_CONFIG),
        [arrayKey]: newArray,
        ...(legacyKey ? { [legacyKey]: newArray[0] || '' } : {})
      };
      saveDiscoveryPayload(next);
      return next;
    });
  };

  const handleAddDiscoveryTag = (arrayKey, legacyKey, inputValue, setInput) => {
    const raw = typeof inputValue === 'string' ? inputValue : '';
    if (!raw.trim()) return;
    const items = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (items.length === 0) return;

    setDiscoveryConfig(prev => {
      const curList = getDiscoveryArray(prev, arrayKey, legacyKey);
      const toAdd = items.filter(item => !curList.some(existing => existing.toLowerCase() === item.toLowerCase()));
      if (toAdd.length === 0) return prev;
      const updated = [...curList, ...toAdd];
      const next = {
        ...(prev || DEFAULT_DISCOVERY_CONFIG),
        [arrayKey]: updated,
        ...(legacyKey ? { [legacyKey]: updated[0] || '' } : {})
      };
      saveDiscoveryPayload(next);
      return next;
    });
    if (setInput) setInput('');
  };

  // Instant comma-break as user types or pastes text
  const handleDiscoveryTagInputChange = (arrayKey, legacyKey, value, setInput) => {
    if (value.includes(',')) {
      const parts = value.split(',');
      const trailing = parts.pop(); // text after the last comma
      const completed = parts.map(p => p.trim()).filter(Boolean);
      if (completed.length > 0) {
        handleAddDiscoveryTag(arrayKey, legacyKey, completed.join(','), null);
      }
      setInput(trailing ? trailing.trimStart() : '');
    } else {
      setInput(value);
    }
  };

  // Flushes any uncommitted text sitting in discovery input fields into actual tags
  const flushPendingDiscoveryInputs = () => {
    let nextConfig = { ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG) };
    let changed = false;

    const flushField = (inputVal, arrayKey, legacyKey, setInput) => {
      const raw = (inputVal || '').trim();
      if (!raw) return;
      const items = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (items.length === 0) return;
      const existing = getDiscoveryArray(nextConfig, arrayKey, legacyKey);
      const toAdd = items.filter(item => !existing.some(x => x.toLowerCase() === item.toLowerCase()));
      if (toAdd.length > 0) {
        nextConfig = {
          ...nextConfig,
          [arrayKey]: [...existing, ...toAdd],
          ...(legacyKey ? { [legacyKey]: existing[0] || toAdd[0] || '' } : {})
        };
        changed = true;
      }
      if (setInput) setInput('');
    };

    flushField(newCountryInput, 'target_countries', null, setNewCountryInput);
    flushField(newRegionInput, 'target_regions', 'location', setNewRegionInput);
    flushField(newPersonaInput, 'target_personas', null, setNewPersonaInput);
    flushField(newInterestInput, 'target_interests', null, setNewInterestInput);
    flushField(newQueryInput, 'search_queries', 'search_query', setNewQueryInput);
    flushField(newIndustryInput, 'target_industries', 'industry', setNewIndustryInput);
    flushField(newTargetRoleInput, 'target_roles', null, setNewTargetRoleInput);

    if (changed) {
      setDiscoveryConfig(nextConfig);
      saveDiscoveryPayload(nextConfig);
    }

    return nextConfig;
  };

  const handleRemoveDiscoveryTag = (arrayKey, legacyKey, indexToRemove) => {
    setDiscoveryConfig(prev => {
      const curList = getDiscoveryArray(prev, arrayKey, legacyKey);
      const updated = curList.filter((_, idx) => idx !== indexToRemove);
      const next = {
        ...(prev || DEFAULT_DISCOVERY_CONFIG),
        [arrayKey]: updated,
        ...(legacyKey ? { [legacyKey]: updated[0] || '' } : {})
      };
      saveDiscoveryPayload(next);
      return next;
    });
  };

  const handleAddTargetRole = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    handleAddDiscoveryTag('target_roles', null, newTargetRoleInput, setNewTargetRoleInput);
  };

  const handleRemoveTargetRole = (indexToRemove) => {
    handleRemoveDiscoveryTag('target_roles', null, indexToRemove);
  };

  const handleCompanySizeToggle = (size) => {
    if (!canEdit) return;
    const curSizes = Array.isArray(discoveryConfig?.target_company_sizes) ? discoveryConfig.target_company_sizes : [];
    const updated = curSizes.includes(size)
      ? curSizes.filter(s => s !== size)
      : [...curSizes, size];
    const next = {
      ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
      target_company_sizes: updated
    };
    setDiscoveryConfig(next);
    saveDiscoveryPayload(next);
  };

  const getDiscoverySources = (config) => {
    if (Array.isArray(config?.sources) && config.sources.length > 0) {
      return config.sources;
    }
    if (config?.source) {
      return [config.source];
    }
    return config?.target_mode === 'b2c' ? ['instagram', 'web_discovery'] : ['linkedin', 'web_discovery'];
  };

  const handleToggleDiscoverySource = (sourceId) => {
    const current = getDiscoverySources(discoveryConfig);
    let updated;
    if (current.includes(sourceId)) {
      if (current.length === 1) {
        showToast('At least one discovery source must remain active.');
        return;
      }
      updated = current.filter(s => s !== sourceId);
    } else {
      updated = [...current, sourceId];
    }
    const next = {
      ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
      sources: updated,
      source: updated[0] || 'web_discovery'
    };
    setDiscoveryConfig(next);
    saveDiscoveryPayload(next);
  };

  const handleUpdateDedupe = (key, value) => {
    setDiscoveryConfig(prev => {
      const curDedupe = (prev || DEFAULT_DISCOVERY_CONFIG).dedupe || {};
      const nextDedupe = { ...curDedupe, [key]: value };
      const next = { ...(prev || DEFAULT_DISCOVERY_CONFIG), dedupe: nextDedupe };
      saveDiscoveryPayload(next);
      return next;
    });
  };

  const handleAiAutoSetup = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const prompt = aiPromptInput.trim();
    if (!prompt || !editingPipelineId) return;

    setIsAiGenerating(true);
    setAiPromptFeedback('');
    try {
      const currentMode = discoveryConfig?.target_mode || 'b2b';
      const generated = await generatePipelineConfigFromPrompt(prompt, { currentMode });
      const effectiveMode = (currentMode === 'b2c' || generated.target_mode === 'b2c') ? 'b2c' : generated.target_mode;

      const updatedConfig = {
        ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
        target_mode: effectiveMode,
        target_countries: Array.isArray(generated.target_countries) && generated.target_countries.length > 0 ? generated.target_countries : (discoveryConfig?.target_countries || []),
        target_country: generated.target_countries?.[0] || discoveryConfig?.target_country || '',
        target_regions: Array.isArray(generated.target_regions) ? generated.target_regions : [],
        target_industries: Array.isArray(generated.target_industries) ? generated.target_industries : [],
        industry: generated.target_industries?.[0] || '',
        target_company_sizes: Array.isArray(generated.target_company_sizes) ? generated.target_company_sizes : [],
        target_roles: Array.isArray(generated.target_roles) ? generated.target_roles : [],
        target_personas: Array.isArray(generated.target_personas) ? generated.target_personas : [],
        target_interests: Array.isArray(generated.target_interests) ? generated.target_interests : [],
        search_queries: Array.isArray(generated.search_queries) ? generated.search_queries : []
      };

      setDiscoveryConfig(updatedConfig);
      await saveDiscoveryPayload(updatedConfig);

      // Auto-update pipeline name if current name is generic
      if (generated.name && (!renameValue || renameValue === 'New Pipeline' || renameValue.toLowerCase().includes('cold') || renameValue.toLowerCase().includes('discovery'))) {
        setRenameValue(generated.name);
        try {
          await supabase
            .from('pipelines')
            .update({ name: generated.name, updated_at: new Date().toISOString() })
            .eq('id', editingPipelineId);
          setPipelines(prev => prev.map(p => p.id === editingPipelineId ? { ...p, name: generated.name } : p));
        } catch (err) {
          console.warn('Could not auto-update pipeline name:', err);
        }
      }

      // Auto-update stages if user still has basic template stages
      if (Array.isArray(generated.stages) && generated.stages.length >= 3) {
        const isDefaultStages = stages.length <= 5 && stages.some(s => s.name?.toLowerCase().includes('discovery') || s.name?.toLowerCase().includes('lead') || s.label?.toLowerCase().includes('discovery'));
        if (isDefaultStages) {
          const newStages = generated.stages.map((st, idx) => ({
            id: `st_${Date.now()}_${idx}`,
            name: st.name,
            label: st.name,
            is_entry: idx === 0,
            is_won: Boolean(st.is_won),
            is_lost: Boolean(st.is_lost)
          }));
          setStages(newStages);
          saveStagesList(newStages);
        }
      }

      const personaCount = updatedConfig.target_personas?.length || 0;
      const interestCount = updatedConfig.target_interests?.length || 0;
      const roleCount = updatedConfig.target_roles?.length || 0;
      const detailMsg = effectiveMode === 'b2c'
        ? `${personaCount} personas and ${interestCount} interests`
        : `${roleCount} roles, ${personaCount} personas, ${interestCount} interests`;

      setAiPromptFeedback(`Configured ${effectiveMode.toUpperCase()} targeting for "${generated.name}" with ${detailMsg}.`);
      setTimeout(() => setAiPromptFeedback(''), 7000);
      showToast(`✨ Pipeline auto-configured for: "${generated.name}"`);
      setAiPromptInput('');
    } catch (err) {
      console.error('AI Auto-setup failed:', err);
      showToast(err.message || 'Failed to auto-configure pipeline with AI');
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleRunDiscovery = async (isDryRun = false) => {
    if (!activePipeline) return;
    const activeConfig = flushPendingDiscoveryInputs();
    if (!hasDiscoveryTargetingCriteria(activeConfig)) {
      const hint = activeConfig?.target_mode === 'b2c'
        ? 'Country, City, Customer Persona, or Interest'
        : 'Country, Region, Industry, or Query';
      showToast?.(`Please configure at least one targeting criterion (${hint}) before running discovery.`, 'warning');
      return;
    }
    setIsRunningDiscovery(true);
    setDiscoveryRunModal({
      stage: 'running',
      dryRun: isDryRun,
      totalFound: 0,
      insertedCount: 0,
      duplicatesCount: 0,
      enrichedCount: 0
    });

    try {
      const res = await runColdDiscoveryBatch({
        pipeline: {
          ...activePipeline,
          discovery_config: activeConfig
        },
        usersList,
        dryRun: isDryRun
      });

      setDiscoveryRunModal({
        stage: 'completed',
        dryRun: isDryRun,
        ...res
      });

      if (!isDryRun) {
        const nextRun = discoveryConfig?.autopilot_enabled
          ? calculateNextDiscoveryRun(discoveryConfig?.schedule_cadence || 'weekdays', discoveryConfig?.schedule_time || '09:00')
          : discoveryConfig?.next_run_at;
        const updatedStats = {
          last_run_at: new Date().toISOString(),
          next_run_at: nextRun,
          last_run_stats: {
            total_scraped: res.totalFound,
            inserted: res.insertedCount,
            duplicates_skipped: res.duplicatesCount,
            enriched: res.enrichedCount
          }
        };
        setDiscoveryConfig(prev => ({
          ...prev,
          ...updatedStats
        }));
        if (res.insertedCount > 0) {
          showToast(`Ingested ${res.insertedCount} new prospect(s) into pipeline!`);
          const { data: updatedLeads } = await supabase
            .from('leads')
            .select('id, stage, pipeline_id, form_id, form_name, custom_fields');
          if (updatedLeads) setAllLeads(updatedLeads);
        }
      }
    } catch (err) {
      console.error('Discovery run error:', err);
      setDiscoveryRunModal({
        stage: 'error',
        error: err.message
      });
      showToast(`Discovery error: ${err.message}`);
    } finally {
      setIsRunningDiscovery(false);
    }
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
          localStorage.setItem(cacheKey, JSON.stringify(updated));
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

  const handleToggleMetaCapiAutomation = (stageId, checked) => {
    let exists = false;
    let updated = stageAutomations.map(a => {
      if (a.stage_id === stageId) {
        exists = true;
        const defaultEvt = a.meta_capi_event || 'QualifiedLead';
        return { ...a, meta_capi_active: checked, meta_capi_event: defaultEvt };
      }
      return a;
    });

    if (!exists) {
      updated.push({
        stage_id: stageId,
        is_active: false,
        template_name: '',
        email_active: false,
        email_template_id: '',
        meta_capi_active: checked,
        meta_capi_event: 'QualifiedLead'
      });
    }

    setStageAutomations(updated);
    saveStageAutomations(updated);
  };

  const handleSelectMetaCapiEvent = (stageId, eventName) => {
    let exists = false;
    let updated = stageAutomations.map(a => {
      if (a.stage_id === stageId) {
        exists = true;
        return { ...a, meta_capi_event: eventName };
      }
      return a;
    });

    if (!exists) {
      updated.push({
        stage_id: stageId,
        is_active: false,
        template_name: '',
        email_active: false,
        email_template_id: '',
        meta_capi_active: true,
        meta_capi_event: eventName
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
    setPipelineFields([]);
    setNewFieldName('');
    setNewFieldMappedQuestion('');
  };

  // Pipeline Field Handlers
  const handleToggleShowOnCard = (fieldKey) => {
    const updated = pipelineFields.map(f => f.key === fieldKey ? { ...f, show_on_card: !f.show_on_card } : f);
    setPipelineFields(updated);
    savePipelineFields(updated);
  };

  const handleFieldNameChange = (fieldKey, newLabel) => {
    const updated = pipelineFields.map(f => f.key === fieldKey ? { ...f, label: newLabel } : f);
    setPipelineFields(updated);
  };

  const handleFieldMappingChange = (fieldKey, mappedQuestion) => {
    const updated = pipelineFields.map(f => f.key === fieldKey ? { ...f, mapped_question: mappedQuestion } : f);
    setPipelineFields(updated);
    savePipelineFields(updated);
    showToast('Updated field mapping');
  };

  const handleFieldBlur = () => {
    savePipelineFields(pipelineFields);
  };

  const handleSelectFormQuestionToAdd = (question) => {
    setNewFieldMappedQuestion(question);
    if (question) {
      const clean = question
        .replace(/\?$/, '')
        .replace(/^Which\s+/i, '')
        .replace(/^What\s+is\s+your\s+/i, '')
        .replace(/^What\s+/i, '')
        .replace(/^Do\s+you\s+/i, '')
        .replace(/^Have\s+you\s+ever\s+been\s+a\s+/i, '')
        .replace(/^Have\s+you\s+ever\s+/i, '')
        .replace(/^How\s+soon\s+are\s+you\s+looking\s+to\s+/i, '')
        .trim();
      const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);
      setNewFieldName(capitalized.slice(0, 32));
    }
  };

  const handleAddField = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    const key = labelToKey(trimmed);
    if (pipelineFields.some(f => f.key === key)) {
      showToast(`Field "${key}" already exists`);
      return;
    }
    const updated = [
      ...pipelineFields,
      {
        key,
        label: trimmed,
        mapped_question: pipelineType === 'sales' ? (newFieldMappedQuestion || key) : '',
        show_on_card: false,
        is_core: false
      }
    ];
    setPipelineFields(updated);
    setNewFieldName('');
    setNewFieldMappedQuestion('');
    savePipelineFields(updated);
    showToast(`Added field "${trimmed}"`);
  };

  const handleDeleteField = (fieldKey) => {
    const target = pipelineFields.find(f => f.key === fieldKey);
    if (target?.is_core) {
      showToast('Core fields cannot be deleted');
      return;
    }
    const updated = pipelineFields.filter(f => f.key !== fieldKey);
    setPipelineFields(updated);
    savePipelineFields(updated);
    showToast(`Removed field "${target?.label || fieldKey}"`);
  };

  const savePipelineFields = async (updated) => {
    if (!editingPipelineId) return;
    try {
      const { error } = await supabase
        .from('pipelines')
        .update({ pipeline_fields: updated })
        .eq('id', editingPipelineId);

      if (error) throw error;

      setPipelines(prev => prev.map(p => p.id === editingPipelineId ? { ...p, pipeline_fields: updated } : p));
      try {
        const cached = pipelines.map(p => p.id === editingPipelineId ? { ...p, pipeline_fields: updated } : p);
        localStorage.setItem(cacheKey, JSON.stringify(cached));
      } catch (e) {}
      triggerSavedFeedback();
    } catch (err) {
      console.error('Error saving pipeline fields:', err);
      showToast('Failed to save fields');
    }
  };



  // Create new pipeline
  const handleCreatePipeline = async () => {
    const promptText = pipelineType === 'cold' ? 'Enter new discovery pipeline name:' : 'Enter new pipeline name:';
    const name = window.prompt(promptText);
    if (!name || !name.trim()) return;

    const starterStages = pipelineType === 'cold' ? [
      { id: 'prospect', label: 'Prospect', order: 0, is_entry: true, is_won: false, is_lost: false },
      { id: 'contacted', label: 'Contacted', order: 1, is_entry: false, is_won: false, is_lost: false },
      { id: 'follow_up', label: 'Follow-Up', order: 2, is_entry: false, is_won: false, is_lost: false },
      { id: 'meeting', label: 'Meeting Scheduled', order: 3, is_entry: false, is_won: false, is_lost: false },
      { id: 'qualified', label: 'Qualified', order: 4, is_entry: false, is_won: true, is_lost: false },
      { id: 'lost', label: 'Unresponsive / Lost', order: 5, is_entry: false, is_won: false, is_lost: true }
    ] : [
      { id: 'new', label: 'New Leads', order: 0, is_entry: true, is_won: false, is_lost: false },
      { id: 'contacted', label: 'Contacted', order: 1, is_entry: false, is_won: false, is_lost: false },
      { id: 'proposal', label: 'Proposal Sent', order: 2, is_entry: false, is_won: false, is_lost: false },
      { id: 'won', label: 'Won', order: 3, is_entry: false, is_won: true, is_lost: false },
      { id: 'lost', label: 'Lost', order: 4, is_entry: false, is_won: false, is_lost: true }
    ];

    const starterFields = pipelineType === 'cold' ? DEFAULT_COLD_PIPELINE_FIELDS : DEFAULT_PIPELINE_FIELDS;

    try {
      const { data: newPipe, error } = await supabase
        .from('pipelines')
        .insert([{
          name: name.trim(),
          pipeline_type: pipelineType,
          is_default: pipelines.length === 0,
          stages: starterStages,
          pipeline_fields: starterFields
        }])
        .select()
        .single();

      if (error) throw error;

      const updated = [...pipelines, newPipe];
      setPipelines(updated);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(updated));
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

      setPipelines(prev => {
        const updated = prev.map(p => p.id === editingPipelineId ? { ...p, name: trimmed } : p);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(updated));
        } catch (e) {}
        return updated;
      });
      showToast('Pipeline renamed.');
    } catch (err) {
      console.error('Error renaming pipeline:', err);
      showToast('Failed to rename pipeline.');
    }
  };

  // Delete pipeline
  const handleDeletePipeline = async (pipeToDelete, e) => {
    if (e) e.stopPropagation();

    if (pipelineType === 'sales' && pipelines.length <= 1) {
      alert('You must have at least one sales pipeline in your CRM.');
      return;
    }

    const pLeads = allLeads.filter(l => l.pipeline_id === pipeToDelete.id || (!l.pipeline_id && pipeToDelete.is_default));
    const otherPipes = pipelines.filter(p => p.id !== pipeToDelete.id);
    const targetFallbackPipe = otherPipes.find(p => p.is_default) || otherPipes[0];

    // If deleting the only cold pipeline
    if (!targetFallbackPipe) {
      if (!window.confirm(`Delete pipeline "${pipeToDelete.name}"?`)) return;
      try {
        const { error } = await supabase.from('pipelines').delete().eq('id', pipeToDelete.id);
        if (error) throw error;
        setPipelines([]);
        try {
          localStorage.removeItem(cacheKey);
        } catch (e) { }
        if (editingPipelineId === pipeToDelete.id) {
          setEditingPipelineId(null);
          setStages([]);
          setInitialStages([]);
          if (onConfigureStateChange) onConfigureStateChange(false);
        }
        showToast(`Pipeline "${pipeToDelete.name}" deleted.`);
        return;
      } catch (err) {
        console.error('Error deleting pipeline:', err);
        showToast('Failed to delete pipeline.');
        return;
      }
    }

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
      try {
        localStorage.setItem(cacheKey, JSON.stringify(remaining));
      } catch (e) { }

      if (editingPipelineId === pipeToDelete.id) {
        setEditingPipelineId(null);
        setStages([]);
        setInitialStages([]);
        if (onConfigureStateChange) onConfigureStateChange(false);
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

      showToast(formId ? 'Form linked.' : 'Form unlinked.');
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
        is_entry: Boolean(st.is_entry),
        is_won: Boolean(st.is_won),
        is_lost: Boolean(st.is_lost)
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
      setPipelines(prev => {
        const updated = prev.map(p => p.id === editingPipelineId ? { ...p, stages: normalizedStages } : p);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(updated));
        } catch (e) { }
        return updated;
      });

      if (activePipeline?.is_default && pipelineType === 'sales') {
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
      is_entry: st.id === stageId,
      is_won: st.id === stageId ? false : st.is_won,
      is_lost: st.id === stageId ? false : st.is_lost
    }));
    setStages(updated);
    saveStagesList(updated);
  };

  const handleSetWonStage = (stageId) => {
    const updated = stages.map(st => ({
      ...st,
      is_won: st.id === stageId ? !st.is_won : false,
      is_entry: st.id === stageId ? false : st.is_entry,
      is_lost: st.id === stageId ? false : st.is_lost
    }));
    setStages(updated);
    saveStagesList(updated);
  };

  const handleSetLostStage = (stageId) => {
    const updated = stages.map(st => ({
      ...st,
      is_lost: st.id === stageId ? !st.is_lost : false,
      is_entry: st.id === stageId ? false : st.is_entry,
      is_won: st.id === stageId ? false : st.is_won
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
              <h1 className="pipeline-master-title">
                {pipelineType === 'cold' ? 'Discovery Pipelines' : 'Pipelines'}
              </h1>
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
      {/* Mobile Overview View (Strictly visible on mobile <= 900px) */}
      <div className="pipeline-mobile-overview-view">
        <div className="pipeline-mobile-overview-card">
          <div className="pipeline-mobile-overview-table-header">
            <span className="pipeline-overview-th-left">{pipelineType === 'cold' ? 'Discovery Pipeline' : 'Pipeline'}</span>
            <span className="pipeline-overview-th-right">Stages</span>
          </div>

          <div className="pipeline-mobile-overview-table-body">
            {pipelines.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                No {pipelineType === 'cold' ? 'discovery ' : ''}pipelines yet.
              </div>
            ) : (
              pipelines.map((pipe) => {
                const pipeStages = Array.isArray(pipe.stages) ? pipe.stages : [];
                const pipeLeads = allLeads.filter(l => {
                  if (pipelineType === 'cold') return l.pipeline_id === pipe.id;
                  return l.pipeline_id === pipe.id || (!l.pipeline_id && pipe.is_default);
                });
                const form = pipelineType === 'sales' ? connectedForms.find(f => f.pipeline_id === pipe.id) : null;

                return (
                  <div key={pipe.id} className="pipeline-mobile-overview-row">
                    <div className="pipeline-mobile-overview-left">
                      <div className="pipeline-mobile-overview-icon-box">
                        <GitFork size={18} style={{ color: '#0f172a' }} />
                      </div>
                      <div className="pipeline-mobile-overview-info">
                        <div className="pipeline-mobile-overview-name-row">
                          <span className="pipeline-mobile-overview-name">{pipe.name}</span>
                          {pipe.is_default && (
                            <span className="pipeline-mobile-default-tag">Default</span>
                          )}
                        </div>
                        <span className="pipeline-mobile-overview-sub">
                          {pipeLeads.length} {pipeLeads.length === 1 ? 'lead' : 'leads'}
                          {form ? ` · ${form.form_name || `Form ${form.form_id}`}` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="pipeline-mobile-overview-right">
                      <span className="pipeline-mobile-stages-badge">
                        {pipeStages.length} {pipeStages.length === 1 ? 'Stage' : 'Stages'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Clean Desktop Notice Banner */}
        <div className="pipeline-mobile-desktop-notice">
          <div className="pipeline-notice-icon-box">
            <Monitor size={17} strokeWidth={1.75} />
          </div>
          <div className="pipeline-notice-text-col">
            <span className="pipeline-notice-title">Desktop Management</span>
            <span className="pipeline-notice-desc">
              To create pipelines, customize stages, or set up lead distribution rules, open simplecrm on your computer.
            </span>
          </div>
        </div>
      </div>

      {/* Desktop Full-Featured View (Hidden on mobile <= 900px) */}
      <div className="pipeline-desktop-full-view">
        {/* ==============================================================
            STATE A: MASTER VIEW (NO STAGES DIRECTLY SHOWN ON OPEN)
            ============================================================== */}
        {editingPipelineId === null ? (
        <div className="pipeline-view-inner">
          <div className="pipeline-master-header">
            <div className="pipeline-master-title-group">
              <h1 className="pipeline-master-title">
                {pipelineType === 'cold' ? 'Discovery Pipelines' : 'Pipelines'}
              </h1>
              <span className="pipeline-master-count">{pipelines.length}</span>
            </div>

            {canEdit && (
              <button
                type="button"
                className="btn-minimal-save"
                onClick={handleCreatePipeline}
              >
                <Plus size={15} strokeWidth={2} />
                <span>{pipelineType === 'cold' ? 'New Discovery Pipeline' : 'New Pipeline'}</span>
              </button>
            )}
          </div>

          <div className="pipeline-cards-list">
            {pipelines.length === 0 ? (
              <div
                className="pipeline-card-row"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '48px 24px',
                  textAlign: 'center',
                  cursor: 'default',
                  background: '#ffffff'
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: '#f8fafc',
                    color: '#64748b',
                    marginBottom: 12
                  }}
                >
                  <Compass size={22} strokeWidth={1.75} />
                </div>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', margin: '0 0 6px 0' }}>
                  No {pipelineType === 'cold' ? 'Discovery ' : ''}Pipelines Configured
                </h3>
                <p style={{ fontSize: '13px', color: '#64748b', maxWidth: 380, margin: '0 0 16px 0', lineHeight: 1.5 }}>
                  {pipelineType === 'cold'
                    ? 'Create your first discovery pipeline to configure custom qualification stages, lead distribution, and stage automations.'
                    : 'Create a pipeline to define stages and track your inbound leads.'}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    className="btn-minimal-save"
                    onClick={handleCreatePipeline}
                  >
                    <Plus size={15} strokeWidth={2} />
                    <span>Create {pipelineType === 'cold' ? 'Discovery Pipeline' : 'Pipeline'}</span>
                  </button>
                )}
              </div>
            ) : (
              pipelines.map((pipe) => {
              const pipeStages = Array.isArray(pipe.stages) ? pipe.stages : [];
              const pipeLeads = allLeads.filter(l => {
                if (pipelineType === 'cold') return l.pipeline_id === pipe.id;
                return l.pipeline_id === pipe.id || (!l.pipeline_id && pipe.is_default);
              });
              const form = pipelineType === 'sales' ? connectedForms.find(f => f.pipeline_id === pipe.id) : null;

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
            }))}
          </div>
        </div>
      ) : (
        /* ==============================================================
           STATE B: CONFIGURE SPLIT LAYOUT (COLLAPSED ADMIN SUBNAV + DEDICATED PIPELINE SUBNAV)
           ============================================================== */
        <div className="pipeline-config-layout">
          {/* Left Contextual Pipeline Sidebar */}
          <div className="pipeline-config-subnav">
            <div className="pipeline-config-identity" ref={pipelineDropdownRef}>
              <button
                type="button"
                className={`pipeline-config-switcher-btn ${isPipelineDropdownOpen ? 'active' : ''}`}
                onClick={() => setIsPipelineDropdownOpen(prev => !prev)}
                title="Switch pipeline"
                aria-expanded={isPipelineDropdownOpen}
              >
                <h2 className="pipeline-config-title" title={activePipeline?.name}>
                  {activePipeline?.name}
                </h2>
                <ChevronDown size={15} strokeWidth={2.2} className="pipeline-config-switcher-chevron" />
              </button>

              {isPipelineDropdownOpen && (
                <div className="pipeline-config-dropdown-menu">
                  <div className="pipeline-config-dropdown-header">
                    {pipelineType === 'cold' ? 'Select Discovery Pipeline' : 'Select Pipeline'}
                  </div>
                  {pipelines.map((pipe) => {
                    const isSelected = pipe.id === activePipeline?.id;
                    return (
                      <button
                        key={pipe.id}
                        type="button"
                        className={`pipeline-config-dropdown-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setIsPipelineDropdownOpen(false);
                          if (pipe.id !== activePipeline?.id) {
                            handleOpenConfigure(pipe, configureSubTab);
                          }
                        }}
                      >
                        <div className="pipeline-config-dropdown-item-left">
                          <span className="pipeline-config-dropdown-name" title={pipe.name}>
                            {pipe.name}
                          </span>
                          {pipe.is_default && (
                            <span className="pipeline-config-default-pill">Default</span>
                          )}
                        </div>
                        {isSelected && (
                          <Check size={14} strokeWidth={2.5} className="pipeline-config-dropdown-check" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pipeline Configure Tabs List */}
            <ul className="pipeline-config-nav-list">
              <li>
                <button
                  type="button"
                  className={`pipeline-config-nav-btn ${(configureSubTab === 'setup' || configureSubTab === 'general' || configureSubTab === 'targeting') ? 'active' : ''}`}
                  onClick={() => setConfigureSubTab('setup')}
                >
                  <Sliders size={20} strokeWidth={1.75} />
                  <span>Setup</span>
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
                  className={`pipeline-config-nav-btn ${configureSubTab === 'fields' ? 'active' : ''}`}
                  onClick={() => setConfigureSubTab('fields')}
                >
                  <ListFilter size={20} strokeWidth={1.75} />
                  <span>Fields</span>
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
                title="Back"
              >
                <ArrowLeft size={20} strokeWidth={1.75} />
                <span>Back</span>
              </button>
            </div>
          </div>

          {/* Right Content Workspace Pane */}
          <div className="pipeline-config-content">
            {/* Auto-save status indicator for other tabs */}
            {!(configureSubTab === 'setup' || configureSubTab === 'general' || configureSubTab === 'targeting') && (
              <div className="pipeline-content-actions-fixed">
                {(isSaving || isSavingDist || isSavingDiscovery) ? (
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
            )}

            {/* TAB 1: SETUP CONTENT (Ultra-Clean Minimal Property List) */}
            {(configureSubTab === 'setup' || configureSubTab === 'general' || configureSubTab === 'targeting') && (
              <>
                <div className="pipeline-prop-list">
                  {/* Top Content Header Bar (part of pipeline-prop-list) */}
                  <div className="pipeline-content-header-bar">
                    <div className="pipeline-header-left">
                      {pipelineType === 'cold' && (
                        <span className="pipeline-header-telemetry">
                          {discoveryConfig?.last_run_at ? (
                            `Last sweep: ${discoveryConfig.last_run_stats?.inserted || 0} ingested, ${discoveryConfig.last_run_stats?.duplicates_skipped || 0} skipped`
                          ) : (
                            'Ready to sweep'
                          )}
                        </span>
                      )}
                    </div>
                    <div className="pipeline-header-right">
                      {(isSaving || isSavingDist || isSavingDiscovery) ? (
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

                      {pipelineType === 'cold' && (
                        <div className="pipeline-header-discovery-suite">
                          {!hasTargetingCriteria && (
                            <span className="pipeline-header-warning" title="Add targeting criteria before running">
                              <AlertCircle size={13} />
                              <span>Add criteria</span>
                            </span>
                          )}

                          <button
                            type="button"
                            className="btn-discovery-dryrun"
                            onClick={() => handleRunDiscovery(true)}
                            disabled={isRunningDiscovery || !hasTargetingCriteria}
                            title="Preview prospects without ingesting"
                          >
                            <Search size={13} />
                            <span>Preview</span>
                          </button>

                          <button
                            type="button"
                            className="btn-discovery-run"
                            onClick={() => handleRunDiscovery(false)}
                            disabled={isRunningDiscovery || !hasTargetingCriteria}
                            title="Discover and ingest prospects"
                          >
                            {isRunningDiscovery ? (
                              <>
                                <RefreshCw size={13} className="spin-icon" />
                                <span>Discovering...</span>
                              </>
                            ) : (
                              <>
                                <Play size={13} fill="currentColor" />
                                <span>Run Discovery</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 1. Pipeline Name */}
                  <div className="pipeline-prop-row">
                  <div className="pipeline-prop-label-col">
                    <div className="pipeline-prop-icon">
                      <Layers size={20} />
                    </div>
                    <span className="pipeline-prop-name">Pipeline Name</span>
                  </div>
                  <div className="pipeline-prop-value-col">
                    <form onSubmit={handleRenameSubmit} style={{ width: '100%', margin: 0 }}>
                      <input
                        type="text"
                        className="pipeline-prop-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameSubmit}
                        placeholder="e.g. Sales Pipeline"
                        readOnly={!canEdit}
                      />
                    </form>
                  </div>
                  <div className="pipeline-prop-action-col">
                    <button type="button" className="pipeline-prop-action-btn" title="Edit pipeline name">
                      <Edit2 size={18} />
                    </button>
                  </div>
                </div>

                {/* 2. Audience Mode (Cold Discovery) */}
                {pipelineType === 'cold' && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <Users size={20} />
                      </div>
                      <span className="pipeline-prop-name">Audience Mode</span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      <select
                        className="pipeline-prop-input"
                        style={{ cursor: canEdit ? 'pointer' : 'default', appearance: 'none', WebkitAppearance: 'none', background: 'transparent' }}
                        value={discoveryConfig?.target_mode === 'b2c' ? 'b2c' : 'b2b'}
                        onChange={(e) => {
                          if (!canEdit) return;
                          const val = e.target.value;
                          const curSources = getDiscoverySources(discoveryConfig);
                          if (val === 'b2c') {
                            const hasB2CSources = curSources.some(s => ['reddit', 'quora', 'instagram'].includes(s));
                            const updated = {
                              ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
                              target_mode: 'b2c',
                              sources: hasB2CSources ? curSources : ['reddit', 'quora', 'instagram'],
                              source: 'reddit'
                            };
                            setDiscoveryConfig(updated);
                            saveDiscoveryPayload(updated);
                          } else {
                            const hasB2BSources = curSources.some(s => ['linkedin', 'clutch', 'google_places'].includes(s));
                            const updated = {
                              ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
                              target_mode: 'b2b',
                              sources: hasB2BSources ? curSources : ['linkedin', 'web_discovery'],
                              source: 'linkedin'
                            };
                            setDiscoveryConfig(updated);
                            saveDiscoveryPayload(updated);
                          }
                        }}
                        disabled={!canEdit}
                      >
                        <option value="b2c">B2C (Consumer)</option>
                        <option value="b2b">B2B (Business)</option>
                      </select>
                    </div>
                    <div className="pipeline-prop-action-col">
                      <button type="button" className="pipeline-prop-action-btn" title="Toggle audience mode">
                        <ChevronDown size={18} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Lead Source (Inbound Sales only) */}
                {pipelineType === 'sales' && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <FileText size={20} />
                      </div>
                      <span className="pipeline-prop-name">Inbound Lead Form</span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      {attachedForm ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 17, fontWeight: 400, color: '#0f172a' }}>
                            {formatFormName(attachedForm)}
                          </span>
                          <span style={{ fontSize: 13, color: '#64748b' }}>
                            ({attachedForm.source === 'website' ? 'Website Form' : 'Meta Form'})
                          </span>
                        </div>
                      ) : (
                        <select
                          className="pipeline-prop-input"
                          style={{ cursor: canEdit ? 'pointer' : 'default', appearance: 'none', WebkitAppearance: 'none', background: 'transparent' }}
                          value=""
                          onChange={(e) => handleFormChange(e.target.value || null)}
                          disabled={!canEdit}
                        >
                          <option value="" disabled>Select inbound form...</option>
                          {connectedForms.map(f => (
                            <option key={f.form_id} value={f.form_id}>
                              {f.source === 'website' ? `[Website] ${formatFormName(f)}` : formatFormName(f)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="pipeline-prop-action-col">
                      {attachedForm ? (
                        canEdit && (
                          <button
                            type="button"
                            className="pipeline-prop-action-btn"
                            onClick={() => handleFormChange(null)}
                            title="Disconnect form"
                            aria-label="Disconnect form"
                          >
                            <Unlink size={18} />
                          </button>
                        )
                      ) : (
                        <div className="pipeline-prop-action-btn" style={{ pointerEvents: 'none' }}>
                          <ChevronDown size={18} />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. Channels (Cold Discovery) */}
                {pipelineType === 'cold' && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <LayoutGrid size={20} />
                      </div>
                      <span className="pipeline-prop-name">Channels</span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      <div className="pipeline-prop-pills-wrap">
                        {getDiscoverySources(discoveryConfig).map((sourceId) => {
                          const allSources = discoveryConfig?.target_mode === 'b2c' ? B2C_DISCOVERY_SOURCES : B2B_DISCOVERY_SOURCES;
                          const s = allSources.find(item => item.id === sourceId) || DISCOVERY_SOURCES.find(item => item.id === sourceId);
                          const label = s ? getSourceShortName(s) : sourceId;
                          return (
                            <span key={sourceId} className="pipeline-prop-pill">
                              <span>{label}</span>
                              {canEdit && (
                                <button
                                  type="button"
                                  className="pipeline-prop-pill-remove"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleDiscoverySource(sourceId);
                                  }}
                                  title={`Remove ${label}`}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="pipeline-prop-action-col">
                      <button
                        type="button"
                        className="pipeline-prop-action-btn"
                        onClick={() => setIsChannelDropdownOpen(prev => !prev)}
                        title="Toggle channels"
                      >
                        <ChevronDown size={18} />
                      </button>
                    </div>

                    {/* Channels Popover */}
                    {isChannelDropdownOpen && (
                      <div className="pipeline-prop-channels-popover" ref={channelsDropdownRef}>
                        {(discoveryConfig?.target_mode === 'b2c' ? B2C_DISCOVERY_SOURCES : B2B_DISCOVERY_SOURCES).map((s) => {
                          const isSelected = getDiscoverySources(discoveryConfig).includes(s.id);
                          const IconComp = s.icon;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className="pipeline-prop-channel-toggle-item"
                              onClick={() => canEdit && handleToggleDiscoverySource(s.id)}
                              disabled={!canEdit}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <IconComp size={15} color="#64748b" />
                                <span style={{ fontWeight: 500 }}>{s.name}</span>
                              </div>
                              {isSelected && <Check size={14} color="#0f172a" strokeWidth={2.5} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Target Countries (Cold Discovery) */}
                {pipelineType === 'cold' && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <Globe size={20} />
                      </div>
                      <span className="pipeline-prop-name">Target Countries</span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      <PillArrayInput
                        value={getDiscoveryArray(discoveryConfig, 'target_countries', null)}
                        onChange={(arr) => handleDiscoveryArrayChange('target_countries', null, arr)}
                        placeholder="+ add country..."
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="pipeline-prop-action-col">
                      <button type="button" className="pipeline-prop-action-btn" title="Add country">
                        <ChevronDown size={18} />
                      </button>
                    </div>
                  </div>
                )}

                {/* 5. Target Cities & Areas (Cold Discovery) */}
                {pipelineType === 'cold' && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <MapPin size={20} />
                      </div>
                      <span className="pipeline-prop-name">
                        {discoveryConfig?.target_mode === 'b2c' ? 'Target Cities & Areas' : 'Target Cities & Regions'}
                      </span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      <PillArrayInput
                        value={getDiscoveryArray(discoveryConfig, 'target_regions', 'location')}
                        onChange={(arr) => handleDiscoveryArrayChange('target_regions', 'location', arr)}
                        placeholder="+ add city or region..."
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="pipeline-prop-action-col">
                      <button type="button" className="pipeline-prop-action-btn" title="Add city">
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </div>
                )}

                {/* 6. Target Personas / Target Industries (Cold Discovery) */}
                {pipelineType === 'cold' && (
                  discoveryConfig?.target_mode === 'b2c' ? (
                    <div className="pipeline-prop-row">
                      <div className="pipeline-prop-label-col">
                        <div className="pipeline-prop-icon">
                          <User size={20} />
                        </div>
                        <span className="pipeline-prop-name">Target Personas</span>
                      </div>
                      <div className="pipeline-prop-value-col">
                        <PillArrayInput
                          value={getDiscoveryArray(discoveryConfig, 'target_personas', null)}
                          onChange={(arr) => handleDiscoveryArrayChange('target_personas', null, arr)}
                          placeholder="+ add persona..."
                          disabled={!canEdit}
                        />
                      </div>
                      <div className="pipeline-prop-action-col">
                        <button type="button" className="pipeline-prop-action-btn" title="Add persona">
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pipeline-prop-row">
                      <div className="pipeline-prop-label-col">
                        <div className="pipeline-prop-icon">
                          <Building2 size={20} />
                        </div>
                        <span className="pipeline-prop-name">Target Industries</span>
                      </div>
                      <div className="pipeline-prop-value-col">
                        <PillArrayInput
                          value={getDiscoveryArray(discoveryConfig, 'target_industries', 'industry')}
                          onChange={(arr) => handleDiscoveryArrayChange('target_industries', 'industry', arr)}
                          placeholder="+ add industry..."
                          disabled={!canEdit}
                        />
                      </div>
                      <div className="pipeline-prop-action-col">
                        <button type="button" className="pipeline-prop-action-btn" title="Add industry">
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </div>
                  )
                )}

                {/* 7. Inquiries & Buying Intent / B2B Roles & Company Size (Cold Discovery) */}
                {pipelineType === 'cold' && (
                  discoveryConfig?.target_mode === 'b2c' ? (
                    <div className="pipeline-prop-row">
                      <div className="pipeline-prop-label-col">
                        <div className="pipeline-prop-icon">
                          <Target size={20} />
                        </div>
                        <span className="pipeline-prop-name">Inquiries & Buying Intent</span>
                      </div>
                      <div className="pipeline-prop-value-col">
                        <PillArrayInput
                          value={getDiscoveryArray(discoveryConfig, 'target_interests', null)}
                          onChange={(arr) => handleDiscoveryArrayChange('target_interests', null, arr)}
                          placeholder="+ add inquiry or buying intent..."
                          disabled={!canEdit}
                        />
                      </div>
                      <div className="pipeline-prop-action-col">
                        <button type="button" className="pipeline-prop-action-btn" title="Add inquiry intent">
                          <Edit2 size={18} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="pipeline-prop-row">
                        <div className="pipeline-prop-label-col">
                          <div className="pipeline-prop-icon">
                            <Users size={20} />
                          </div>
                          <span className="pipeline-prop-name">Company Size</span>
                        </div>
                        <div className="pipeline-prop-value-col">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {COMPANY_SIZE_OPTIONS.map((size) => {
                              const isSelected = Array.isArray(discoveryConfig?.target_company_sizes) && discoveryConfig.target_company_sizes.includes(size);
                              return (
                                <button
                                  key={size}
                                  type="button"
                                  className={`pipeline-prop-pill ${isSelected ? 'is-active' : ''}`}
                                  style={{
                                    background: isSelected ? '#0f172a' : '#f1f5f9',
                                    color: isSelected ? '#ffffff' : '#0f172a',
                                    cursor: canEdit ? 'pointer' : 'default',
                                    border: 'none'
                                  }}
                                  onClick={() => canEdit && handleCompanySizeToggle(size)}
                                >
                                  {size}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="pipeline-prop-action-col">
                          <button type="button" className="pipeline-prop-action-btn" title="Edit company size">
                            <Edit2 size={18} />
                          </button>
                        </div>
                      </div>

                      <div className="pipeline-prop-row">
                        <div className="pipeline-prop-label-col">
                          <div className="pipeline-prop-icon">
                            <Briefcase size={20} />
                          </div>
                          <span className="pipeline-prop-name">Job Roles & Titles</span>
                        </div>
                        <div className="pipeline-prop-value-col">
                          <PillArrayInput
                            value={getDiscoveryArray(discoveryConfig, 'target_roles', null)}
                            onChange={(arr) => handleDiscoveryArrayChange('target_roles', null, arr)}
                            placeholder="+ add job role or title..."
                            disabled={!canEdit}
                          />
                        </div>
                        <div className="pipeline-prop-action-col">
                          <button type="button" className="pipeline-prop-action-btn" title="Add job role">
                            <Edit2 size={18} />
                          </button>
                        </div>
                      </div>
                    </>
                  )
                )}

                {/* 8. Search Keywords (Cold Discovery) */}
                {pipelineType === 'cold' && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <Search size={20} />
                      </div>
                      <span className="pipeline-prop-name">Search Keywords</span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      <PillArrayInput
                        value={getDiscoveryArray(discoveryConfig, 'search_queries', 'search_query')}
                        onChange={(arr) => handleDiscoveryArrayChange('search_queries', 'search_query', arr)}
                        placeholder="+ add search keyword or query..."
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="pipeline-prop-action-col">
                      <button type="button" className="pipeline-prop-action-btn" title="Add keyword">
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </div>
                )}

                {/* 9. Webhook URL (if selected) */}
                {pipelineType === 'cold' && getDiscoverySources(discoveryConfig).includes('webhook') && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <Radio size={20} />
                      </div>
                      <span className="pipeline-prop-name">Webhook URL</span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      <input
                        type="url"
                        className="pipeline-prop-input"
                        placeholder="https://api.yourdomain.com/scraper"
                        value={discoveryConfig?.webhook_url || ''}
                        onChange={(e) => handleDiscoveryTextChange('webhook_url', e.target.value)}
                        onBlur={handleDiscoveryBlur}
                        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                        readOnly={!canEdit}
                      />
                    </div>
                    <div className="pipeline-prop-action-col">
                      <button type="button" className="pipeline-prop-action-btn" title="Edit webhook URL">
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </div>
                )}

                {/* 10. Optional Google Maps API Key (if Google Maps selected) */}
                {pipelineType === 'cold' && getDiscoverySources(discoveryConfig).includes('google_places') && (
                  <div className="pipeline-prop-row">
                    <div className="pipeline-prop-label-col">
                      <div className="pipeline-prop-icon">
                        <Compass size={20} />
                      </div>
                      <span className="pipeline-prop-name">Google Maps Key</span>
                    </div>
                    <div className="pipeline-prop-value-col">
                      <input
                        type="password"
                        className="pipeline-prop-input"
                        placeholder="Optional (leave blank for built-in zero-cost web engine)"
                        value={discoveryConfig?.google_maps_api_key || ''}
                        onChange={(e) => handleDiscoveryTextChange('google_maps_api_key', e.target.value)}
                        onBlur={handleDiscoveryBlur}
                        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                        readOnly={!canEdit}
                      />
                    </div>
                    <div className="pipeline-prop-action-col">
                      <button type="button" className="pipeline-prop-action-btn" title="Edit Google Maps API key">
                        <Edit2 size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Outside AI Auto-Setup Callout Section */}
              {pipelineType === 'cold' && (
                <div className="pipeline-prop-ai-section">
                  <div className="pipeline-prop-ai-divider">
                    <span>OR</span>
                  </div>
                  <div className="pipeline-prop-ai-card">
                    <div className="pipeline-prop-ai-header">
                      <Brain size={16} className="pipeline-prop-ai-header-icon" />
                      <span className="pipeline-prop-ai-header-title">Make it easy by asking AI to do it</span>
                    </div>
                    <p className="pipeline-prop-ai-desc">
                      Describe your offering or target audience and let AI automatically generate and fill your targeting criteria.
                    </p>
                    <form onSubmit={handleAiAutoSetup} className="pipeline-prop-ai-form">
                      <input
                        type="text"
                        className="pipeline-prop-ai-input"
                        placeholder='e.g. "HRMS software for mid-size enterprises in India"...'
                        value={aiPromptInput}
                        onChange={(e) => setAiPromptInput(e.target.value)}
                        disabled={!canEdit || isAiGenerating}
                      />
                      <button
                        type="submit"
                        className="pipeline-prop-ai-submit-btn"
                        disabled={!canEdit || isAiGenerating || !aiPromptInput.trim()}
                        title="Auto-fill targeting criteria"
                      >
                        {isAiGenerating ? (
                          <>
                            <RefreshCw size={14} className="crm-spin" />
                            <span>Generating...</span>
                          </>
                        ) : (
                          <>
                            <Brain size={14} />
                            <span>Auto-Fill Criteria</span>
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </>
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
                  const isWon = Boolean(st.is_won);
                  const isLost = Boolean(st.is_lost);

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
                        {/* Entry Stage Trigger */}
                        {isEntry ? (
                          <span
                            className="btn-entry-icon active"
                            data-tooltip="Entry Stage: All new incoming leads land here"
                          >
                            <ArrowDownLeft size={16} strokeWidth={2.25} />
                          </span>
                        ) : (
                          canEdit && (
                            <button
                              type="button"
                              className="btn-entry-icon"
                              onClick={() => handleSetEntryStage(st.id)}
                              data-tooltip="Set as Entry Stage for incoming leads"
                            >
                              <ArrowDownLeft size={16} strokeWidth={2.25} />
                            </button>
                          )
                        )}

                        {/* Won Stage Trigger */}
                        {isWon ? (
                          <button
                            type="button"
                            className="btn-won-icon active"
                            onClick={() => canEdit && handleSetWonStage(st.id)}
                            data-tooltip="Won Stage: Converted deals land here (Click to unset)"
                          >
                            <CheckCircle2 size={16} strokeWidth={2.25} />
                          </button>
                        ) : (
                          canEdit && (
                            <button
                              type="button"
                              className="btn-won-icon"
                              onClick={() => handleSetWonStage(st.id)}
                              data-tooltip="Set as Won / Converted stage"
                            >
                              <CheckCircle2 size={16} strokeWidth={2.25} />
                            </button>
                          )
                        )}

                        {/* Lost Stage Trigger */}
                        {isLost ? (
                          <button
                            type="button"
                            className="btn-lost-icon active"
                            onClick={() => canEdit && handleSetLostStage(st.id)}
                            data-tooltip="Lost Stage: Disqualified leads land here (Click to unset)"
                          >
                            <XCircle size={16} strokeWidth={2.25} />
                          </button>
                        ) : (
                          canEdit && (
                            <button
                              type="button"
                              className="btn-lost-icon"
                              onClick={() => handleSetLostStage(st.id)}
                              data-tooltip="Set as Lost / Disqualified stage"
                            >
                              <XCircle size={16} strokeWidth={2.25} />
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

            {/* TAB: FIELDS & CARD MAPPING CONTENT */}
            {configureSubTab === 'fields' && (
              <div className="pipeline-numbered-list-wrap">
                <div className="pipeline-general-header-between" style={{ marginBottom: 8 }}>
                  <label className="pipeline-general-label" style={{ marginBottom: 0 }}>
                    Pipeline Fields
                  </label>
                  <span className="pipeline-dist-count-badge">
                    {pipelineFields.filter(f => f.show_on_card && f.key !== 'name').length} on card
                  </span>
                </div>

                <div className="pipeline-numbered-list">
                  {pipelineFields.map((field, idx) => {
                    const isSelectOpen = openSelectFieldKey === field.key;
                    return (
                      <div
                        key={field.key}
                        className={`pipeline-numbered-item ${isSelectOpen ? 'has-open-dropdown' : ''}`}
                        style={{
                          zIndex: isSelectOpen ? 200 : (pipelineFields.length + 10 - idx)
                        }}
                      >
                        <div className="pipeline-numbered-left">
                          <span className="pipeline-number-index">{idx + 1}</span>
                          <input
                            type="text"
                            className="pipeline-number-input"
                            value={field.label}
                            onChange={(e) => handleFieldNameChange(field.key, e.target.value)}
                            onBlur={handleFieldBlur}
                            disabled={!canEdit}
                          />
                        </div>

                        {pipelineType === 'sales' && (
                          <div className="pipeline-field-map-slot">
                            <CustomSelect
                              className="pipeline-field-custom-select"
                              value={field.mapped_question || (field.is_core ? field.key : (field.key === 'city' ? (availableFormQuestions.find(q => q.toLowerCase() === 'city') || 'city') : ''))}
                              onChange={(val) => handleFieldMappingChange(field.key, val)}
                              onOpenChange={(isOpen) => setOpenSelectFieldKey(isOpen ? field.key : null)}
                              disabled={!canEdit}
                              placeholder="Select form question..."
                              options={getFieldMappingOptions(field)}
                            />
                          </div>
                        )}

                        <div className="pipeline-numbered-actions">
                          {field.key === 'name' ? (
                            <span
                              className="btn-entry-icon active"
                              data-tooltip="Card Title: Full name is permanently shown on the card header"
                            >
                              <Pin size={17} strokeWidth={2.2} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={`btn-entry-icon ${field.show_on_card ? 'active' : ''}`}
                              onClick={() => handleToggleShowOnCard(field.key)}
                              disabled={!canEdit}
                              data-tooltip={field.show_on_card ? 'Showing on Kanban card (click to hide)' : 'Show on Kanban card'}
                            >
                              <CreditCard size={17} strokeWidth={2.2} />
                            </button>
                          )}

                          {field.is_core ? (
                            <span
                              className="btn-number-trash btn-field-info-icon"
                              data-tooltip={
                                field.key === 'name'
                                  ? 'Core Field: Primary contact name & Kanban card title'
                                  : field.key === 'phone'
                                  ? 'Core Field: Required for WhatsApp automations & direct calls'
                                  : field.key === 'email'
                                  ? 'Core Field: Required for Resend email automations'
                                  : 'Core Field: Built-in contact identity'
                              }
                              data-tooltip-pos="right-edge"
                            >
                              <Info size={16} strokeWidth={2} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn-number-trash"
                              disabled={!canEdit}
                              onClick={() => handleDeleteField(field.key)}
                              data-tooltip={`Delete ${field.label}`}
                              data-tooltip-pos="right-edge"
                            >
                              <Trash2 size={16} strokeWidth={2} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Minimal Inline Add Field Row */}
                  {canEdit && (
                    <form
                      onSubmit={handleAddField}
                      className={`pipeline-numbered-item pipeline-field-add-row ${openSelectFieldKey === '__add_field__' ? 'has-open-dropdown' : ''}`}
                      style={{
                        zIndex: openSelectFieldKey === '__add_field__' ? 200 : 1
                      }}
                    >
                      <div className="pipeline-numbered-left">
                        <span className="pipeline-number-index pipeline-number-index-ghost">
                          {pipelineFields.length + 1}
                        </span>
                        <input
                          type="text"
                          className="pipeline-number-input pipeline-add-input-minimal"
                          placeholder={pipelineType === 'cold' ? "Add a property (e.g. LinkedIn, Company, Designation)..." : "Add a field (e.g. Budget, Package, Timeline)..."}
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                        />
                      </div>

                      {pipelineType === 'sales' && (
                        <div className="pipeline-field-map-slot">
                          <CustomSelect
                            className="pipeline-field-custom-select"
                            value={newFieldMappedQuestion}
                            onChange={(val) => handleSelectFormQuestionToAdd(val)}
                            onOpenChange={(isOpen) => setOpenSelectFieldKey(isOpen ? '__add_field__' : null)}
                            placeholder="Map from form question..."
                            disabled={!canEdit || availableFormQuestions.length === 0}
                            options={[
                              { value: '', label: 'Map from form question...' },
                              ...availableFormQuestions
                                .filter((q) => !pipelineFields.some((f) => f.mapped_question === q))
                                .map((q) => ({ value: q, label: q }))
                            ]}
                          />
                        </div>
                      )}

                      <div className="pipeline-numbered-actions">
                        <button
                          type="submit"
                          disabled={!newFieldName.trim()}
                          className={`btn-entry-icon btn-add-field-action ${newFieldName.trim() ? 'active' : ''}`}
                          data-tooltip={newFieldName.trim() ? 'Add Field' : 'Enter field name'}
                          data-tooltip-pos="right-edge"
                        >
                          <Plus size={17} strokeWidth={2.4} />
                        </button>
                        <span
                          className="btn-number-trash"
                          style={{ visibility: 'hidden', pointerEvents: 'none' }}
                          aria-hidden="true"
                        >
                          <Trash2 size={16} />
                        </span>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}

            {configureSubTab === 'distribution' && (
              <div className="pipeline-general-wrap">
                {/* 1. Distribution Mode Section */}
                <div className="pipeline-general-section">
                  <label className="pipeline-general-label">Distribution Mode</label>

                  <div className="pipeline-name-row">
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

                    <div className="pipeline-name-row">
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

                    <div className="pipeline-name-row">
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
              <div className="pipeline-general-wrap">
                {/* Discovery Autopilot & Deduplication (Cold Discovery only) */}
                {pipelineType === 'cold' && (
                  <>
                    {/* 1. Discovery Autopilot Section */}
                    <div className="pipeline-general-section">
                      <div className="pipeline-general-header">
                        <label className="pipeline-general-label">Discovery Autopilot</label>
                        <p className="pipeline-general-desc">
                          Schedule automated prospect sweeps and set ingest batch sizes.
                        </p>
                      </div>

                      <div className="pipeline-prop-list">
                        {/* Automated Sweeps */}
                        <div className="pipeline-prop-row">
                          <div className="pipeline-prop-label-col">
                            <div className="pipeline-prop-icon">
                              <Radar size={20} />
                            </div>
                            <span className="pipeline-prop-name">Automated Sweeps</span>
                          </div>
                          <div className="pipeline-prop-value-col">
                            <span style={{ fontSize: '15px', color: discoveryConfig?.autopilot_enabled ? '#0f172a' : '#64748b' }}>
                              {discoveryConfig?.autopilot_enabled
                                ? `Next sweep: ${formatNextRunDate(discoveryConfig?.next_run_at)}`
                                : 'Paused (sweeps only run manually)'}
                            </span>
                          </div>
                          <div className="pipeline-prop-action-col">
                            <label className="crm-switch">
                              <input
                                type="checkbox"
                                checked={discoveryConfig?.autopilot_enabled === true}
                                onChange={(e) => {
                                  const isEnabled = e.target.checked;
                                  const nextRun = isEnabled
                                    ? calculateNextDiscoveryRun(discoveryConfig?.schedule_cadence || 'weekdays', discoveryConfig?.schedule_time || '09:00')
                                    : null;
                                  const updated = {
                                    ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
                                    autopilot_enabled: isEnabled,
                                    next_run_at: nextRun
                                  };
                                  setDiscoveryConfig(updated);
                                  saveDiscoveryPayload(updated);
                                }}
                                disabled={!canEdit}
                              />
                              <span className="crm-slider"></span>
                            </label>
                          </div>
                        </div>

                        {/* Schedule Cadence (when active) */}
                        {discoveryConfig?.autopilot_enabled && (
                          <div className="pipeline-prop-row">
                            <div className="pipeline-prop-label-col">
                              <div className="pipeline-prop-icon">
                                <Calendar size={20} />
                              </div>
                              <span className="pipeline-prop-name">Sweep Cadence</span>
                            </div>
                            <div className="pipeline-prop-value-col">
                              <div style={{ maxWidth: 300, width: '100%' }}>
                                <CustomSelect
                                  value={discoveryConfig?.schedule_cadence || 'weekdays'}
                                  onChange={(val) => {
                                    const nextRun = calculateNextDiscoveryRun(val, discoveryConfig?.schedule_time || '09:00');
                                    const next = {
                                      ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
                                      schedule_cadence: val,
                                      next_run_at: nextRun
                                    };
                                    setDiscoveryConfig(next);
                                    saveDiscoveryPayload(next);
                                  }}
                                  options={DISCOVERY_CADENCE_OPTIONS}
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Preferred Sweep Time (when active) */}
                        {discoveryConfig?.autopilot_enabled && (
                          <div className="pipeline-prop-row">
                            <div className="pipeline-prop-label-col">
                              <div className="pipeline-prop-icon">
                                <Clock size={20} />
                              </div>
                              <span className="pipeline-prop-name">Sweep Time</span>
                            </div>
                            <div className="pipeline-prop-value-col">
                              <div style={{ maxWidth: 180, width: '100%' }}>
                                <input
                                  type="time"
                                  className="pipeline-prop-input"
                                  style={{
                                    cursor: canEdit ? 'pointer' : 'default',
                                    fontSize: 16,
                                    fontWeight: 450,
                                    color: '#0f172a',
                                    background: 'transparent',
                                    border: 'none',
                                    padding: '6px 0'
                                  }}
                                  value={discoveryConfig?.schedule_time || '09:00'}
                                  onChange={(e) => {
                                    const newTime = e.target.value || '09:00';
                                    const nextRun = calculateNextDiscoveryRun(
                                      discoveryConfig?.schedule_cadence || 'weekdays',
                                      newTime
                                    );
                                    const updated = {
                                      ...(discoveryConfig || DEFAULT_DISCOVERY_CONFIG),
                                      schedule_time: newTime,
                                      next_run_at: nextRun
                                    };
                                    setDiscoveryConfig(updated);
                                    saveDiscoveryPayload(updated);
                                  }}
                                  disabled={!canEdit}
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Ingest Batch Size */}
                        <div className="pipeline-prop-row">
                          <div className="pipeline-prop-label-col">
                            <div className="pipeline-prop-icon">
                              <Layers size={20} />
                            </div>
                            <span className="pipeline-prop-name">Batch Size</span>
                          </div>
                          <div className="pipeline-prop-value-col">
                            <div style={{ maxWidth: 260, width: '100%' }}>
                              <CustomSelect
                                value={discoveryConfig?.batch_size || 25}
                                onChange={(val) => handleDiscoverySelectChange('batch_size', Number(val))}
                                options={DISCOVERY_BATCH_OPTIONS}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 2. Deduplication Section */}
                    <div className="pipeline-general-section">
                      <div className="pipeline-general-header">
                        <label className="pipeline-general-label">Deduplication</label>
                        <p className="pipeline-general-desc">
                          Prevent duplicate prospects across cold outreach and inbound CRM deals.
                        </p>
                      </div>

                      <div className="pipeline-prop-list">
                        {/* Exclude Pipeline Leads */}
                        <div className="pipeline-prop-row">
                          <div className="pipeline-prop-label-col">
                            <div className="pipeline-prop-icon">
                              <ShieldCheck size={20} />
                            </div>
                            <span className="pipeline-prop-name">Exclude Pipeline Leads</span>
                          </div>
                          <div className="pipeline-prop-value-col">
                            <span style={{ fontSize: '15px', color: '#64748b' }}>
                              Ignore candidates already discovered in this pipeline
                            </span>
                          </div>
                          <div className="pipeline-prop-action-col">
                            <label className="crm-switch">
                              <input
                                type="checkbox"
                                checked={discoveryConfig?.dedupe?.check_cold_leads !== false}
                                onChange={(e) => handleUpdateDedupe('check_cold_leads', e.target.checked)}
                                disabled={!canEdit}
                              />
                              <span className="crm-slider"></span>
                            </label>
                          </div>
                        </div>

                        {/* Exclude Inbound Deals */}
                        <div className="pipeline-prop-row">
                          <div className="pipeline-prop-label-col">
                            <div className="pipeline-prop-icon">
                              <Users size={20} />
                            </div>
                            <span className="pipeline-prop-name">Exclude Inbound Deals</span>
                          </div>
                          <div className="pipeline-prop-value-col">
                            <span style={{ fontSize: '15px', color: '#64748b' }}>
                              Ignore active contacts or deals in inbound sales pipelines
                            </span>
                          </div>
                          <div className="pipeline-prop-action-col">
                            <label className="crm-switch">
                              <input
                                type="checkbox"
                                checked={discoveryConfig?.dedupe?.check_sales_leads !== false}
                                onChange={(e) => handleUpdateDedupe('check_sales_leads', e.target.checked)}
                                disabled={!canEdit}
                              />
                              <span className="crm-slider"></span>
                            </label>
                          </div>
                        </div>

                        {/* Match Duplicates By */}
                        <div className="pipeline-prop-row">
                          <div className="pipeline-prop-label-col">
                            <div className="pipeline-prop-icon">
                              <Search size={20} />
                            </div>
                            <span className="pipeline-prop-name">Match Duplicates By</span>
                          </div>
                          <div className="pipeline-prop-value-col">
                            <div className="pipeline-prop-pills-wrap">
                              <button
                                type="button"
                                className={`pipeline-prop-pill-toggle ${discoveryConfig?.dedupe?.match_email !== false ? 'active' : ''}`}
                                onClick={() => canEdit && handleUpdateDedupe('match_email', !(discoveryConfig?.dedupe?.match_email !== false))}
                                disabled={!canEdit}
                              >
                                <span>Email</span>
                              </button>
                              <button
                                type="button"
                                className={`pipeline-prop-pill-toggle ${discoveryConfig?.dedupe?.match_phone !== false ? 'active' : ''}`}
                                onClick={() => canEdit && handleUpdateDedupe('match_phone', !(discoveryConfig?.dedupe?.match_phone !== false))}
                                disabled={!canEdit}
                              >
                                <span>Phone</span>
                              </button>
                              {discoveryConfig?.target_mode !== 'b2c' && (
                                <button
                                  type="button"
                                  className={`pipeline-prop-pill-toggle ${discoveryConfig?.dedupe?.match_domain !== false ? 'active' : ''}`}
                                  onClick={() => canEdit && handleUpdateDedupe('match_domain', !(discoveryConfig?.dedupe?.match_domain !== false))}
                                  disabled={!canEdit}
                                >
                                  <span>Domain</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className={`pipeline-prop-pill-toggle ${discoveryConfig?.dedupe?.match_linkedin !== false ? 'active' : ''}`}
                                onClick={() => canEdit && handleUpdateDedupe('match_linkedin', !(discoveryConfig?.dedupe?.match_linkedin !== false))}
                                disabled={!canEdit}
                              >
                                <span>{discoveryConfig?.target_mode === 'b2c' ? 'Social Profile' : 'LinkedIn'}</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* On Duplicate Action */}
                        <div className="pipeline-prop-row">
                          <div className="pipeline-prop-label-col">
                            <div className="pipeline-prop-icon">
                              <AlertCircle size={20} />
                            </div>
                            <span className="pipeline-prop-name">On Duplicate Action</span>
                          </div>
                          <div className="pipeline-prop-value-col">
                            <div style={{ maxWidth: 260, width: '100%' }}>
                              <CustomSelect
                                value={discoveryConfig?.dedupe?.on_duplicate || 'skip'}
                                onChange={(val) => handleUpdateDedupe('on_duplicate', val)}
                                options={DUPLICATE_ACTION_OPTIONS}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* 3. Stage Automations Section */}
                <div className="pipeline-general-section">
                  <div className="pipeline-general-header-between" style={{ marginBottom: 12 }}>
                    <div>
                      <label className="pipeline-general-label" style={{ marginBottom: 2 }}>
                        Stage Automations
                      </label>
                      <p className="pipeline-general-desc" style={{ margin: 0 }}>
                        Configure automated actions triggered when cards reach each stage.
                      </p>
                    </div>
                    <span className="pipeline-dist-count-badge">
                      {stageAutomations.filter(a => a.is_active || a.email_active || a.meta_capi_active).length} of {stages.length} stages active
                    </span>
                  </div>

                  <div className="pipeline-dist-numbered-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {stages.map((st, idx) => {
                    const auto = stageAutomations.find(a => a.stage_id === st.id) || {
                      stage_id: st.id,
                      is_active: false,
                      template_name: '',
                      email_active: false,
                      email_template_id: '',
                      meta_capi_active: false,
                      meta_capi_event: 'QualifiedLead'
                    };
                    const isWaActive = !!auto.is_active;
                    const isEmailActive = !!auto.email_active;
                    const isMetaCapiActive = !!auto.meta_capi_active;
                    const isAnyActive = isWaActive || isEmailActive || isMetaCapiActive;

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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                            {isMetaCapiActive && (
                              <span className="pipeline-auto-badge-pill" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="#1877F2">
                                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                                </svg>
                                Meta CAPI: {auto.meta_capi_event || 'QualifiedLead'}
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
                            <span className="pipeline-auto-channel-name">Email</span>
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

                        {/* Meta Conversions API (CAPI) Channel Row */}
                        <div className="pipeline-auto-channel-row">
                          <div className="pipeline-auto-channel-info">
                            <div className="pipeline-auto-channel-icon" style={{ background: '#eff6ff' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2">
                                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                              </svg>
                            </div>
                            <span className="pipeline-auto-channel-name">Meta Conversions API</span>
                          </div>

                          <div className="pipeline-auto-channel-controls">
                            {isMetaCapiActive ? (
                              <div className="pipeline-auto-select-container">
                                <CustomSelect
                                  value={auto.meta_capi_event || 'QualifiedLead'}
                                  onChange={(val) => handleSelectMetaCapiEvent(st.id, val)}
                                  placeholder="Select Meta event..."
                                  options={META_CAPI_EVENTS.map(e => ({
                                    value: e.id,
                                    label: `${e.label} (${e.id})`
                                  }))}
                                />
                              </div>
                            ) : (
                              <span style={{ fontSize: '12.5px', color: '#94a3b8' }}>Disabled</span>
                            )}

                            <button
                              type="button"
                              className={`btn-auto-rectangular-toggle ${isMetaCapiActive ? 'meta-active' : ''}`}
                              onClick={() => handleToggleMetaCapiAutomation(st.id, !isMetaCapiActive)}
                              disabled={!canEdit}
                              data-tooltip={isMetaCapiActive ? 'Meta CAPI Active (click to pause)' : 'Meta CAPI Paused (click to activate)'}
                              data-tooltip-pos="right-edge"
                              aria-label={isMetaCapiActive ? `Pause Meta CAPI for ${st.label}` : `Activate Meta CAPI for ${st.label}`}
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
            </div>
          )}
          </div>
        </div>
      )}
      </div>



      {/* Floating Toast Notification */}
      {toast && (
        <div className="pipeline-toast">
          <Check size={13} strokeWidth={2.5} />
          <span>{toast}</span>
        </div>
      )}

      {/* Discovery Run Modal / Preview Dialog */}
      {discoveryRunModal && (
        <div className="pipeline-discovery-modal-backdrop" onClick={() => !isRunningDiscovery && setDiscoveryRunModal(null)}>
          <div className="pipeline-discovery-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pipeline-discovery-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Compass size={20} strokeWidth={2.2} color="#0f172a" />
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0 }}>
                  {discoveryRunModal.stage === 'running'
                    ? (discoveryRunModal.dryRun ? 'Running Dry Run Preview...' : 'Discovering & Ingesting Leads...')
                    : discoveryRunModal.stage === 'error'
                    ? 'Discovery Run Failed'
                    : (discoveryRunModal.dryRun ? 'Discovery Preview (Dry Run)' : 'Discovery Execution Complete')}
                </h3>
              </div>
              {!isRunningDiscovery && (
                <button
                  type="button"
                  onClick={() => setDiscoveryRunModal(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#64748b' }}
                >
                  <XCircle size={20} />
                </button>
              )}
            </div>

            <div className="pipeline-discovery-modal-body">
              {discoveryRunModal.stage === 'running' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 14 }}>
                  <RefreshCw size={36} className="spin-icon" color="#0f172a" />
                  <p style={{ fontSize: 14, color: '#475569', fontWeight: 500, margin: 0 }}>
                    Searching the web, cross-checking duplicates against existing leads & prospects...
                  </p>
                </div>
              )}

              {discoveryRunModal.stage === 'error' && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
                  <AlertCircle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 600, color: '#991b1b' }}>Error during discovery run</h5>
                    <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>{discoveryRunModal.error}</p>
                  </div>
                </div>
              )}

              {discoveryRunModal.stage === 'completed' && (
                <>
                  {/* Results Summary Pills */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    <div style={{ padding: '12px 14px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{discoveryRunModal.insertedCount || 0}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#15803d', textTransform: 'uppercase' }}>
                        {discoveryRunModal.dryRun ? 'Ready to Ingest' : 'Ingested into Board'}
                      </div>
                    </div>

                    <div style={{ padding: '12px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#d97706' }}>{discoveryRunModal.duplicatesCount || 0}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#b45309', textTransform: 'uppercase' }}>Duplicates Filtered</div>
                    </div>

                    <div style={{ padding: '12px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#2563eb' }}>{discoveryRunModal.enrichedCount || 0}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#1d4ed8', textTransform: 'uppercase' }}>Enriched Records</div>
                    </div>
                  </div>

                  {/* Duplicates Filtered Details (if any) */}
                  {discoveryRunModal.duplicatesList && discoveryRunModal.duplicatesList.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShieldAlert size={15} color="#d97706" />
                        <span>Duplicates Blocked ({discoveryRunModal.duplicatesList.length})</span>
                      </div>
                      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, background: '#fafafa' }}>
                        {discoveryRunModal.duplicatesList.map((dup, idx) => (
                          <div key={idx} style={{ fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: 6 }}>
                            <span style={{ fontWeight: 600, color: '#0f172a' }}>
                              {dup.candidate?.name} {dup.candidate?.company ? `(${dup.candidate.company})` : (dup.candidate?.custom_fields?.persona ? `(${dup.candidate.custom_fields.persona})` : '')}
                            </span>
                            <span style={{ color: '#d97706', fontSize: 11.5, fontWeight: 500 }}>{dup.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Clean Discovered Leads */}
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={15} color="#16a34a" />
                      <span>{discoveryRunModal.dryRun ? 'Candidate Prospects to Ingest' : 'Successfully Ingested Prospects'} ({discoveryRunModal.readyToInsert?.length || 0})</span>
                    </div>
                    <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {(discoveryRunModal.readyToInsert || []).map((lead, idx) => (
                        <div key={idx} style={{ fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                          <div>
                            <span style={{ fontWeight: 600, color: '#0f172a' }}>{lead.name}</span>
                            <span style={{ color: '#64748b', marginLeft: 8 }}>
                              {lead.custom_fields?.target_mode === 'b2c' || (!lead.company && !lead.custom_fields?.company)
                                ? ((lead.custom_fields?.persona || lead.custom_fields?.interest) ? `• ${lead.custom_fields.persona || lead.custom_fields.interest}` : (lead.custom_fields?.location ? `• ${lead.custom_fields.location}` : ''))
                                : `${(lead.company || lead.custom_fields?.company || '')} ${lead.custom_fields?.designation ? `• ${lead.custom_fields.designation}` : ''}`}
                            </span>
                          </div>
                          <span style={{ color: '#0f172a', fontWeight: 500, fontSize: 11.5 }}>{lead.phone || lead.email || 'Verified'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="pipeline-discovery-modal-footer">
              {discoveryRunModal.dryRun && discoveryRunModal.stage === 'completed' && (
                <button
                  type="button"
                  className="btn-discovery-run"
                  onClick={() => handleRunDiscovery(false)}
                  disabled={isRunningDiscovery || (discoveryRunModal.readyToInsert?.length || 0) === 0}
                >
                  <Play size={14} fill="currentColor" />
                  <span>Confirm & Ingest ({discoveryRunModal.readyToInsert?.length || 0}) Leads</span>
                </button>
              )}
              <button
                type="button"
                className="btn-discovery-dryrun"
                onClick={() => setDiscoveryRunModal(null)}
                disabled={isRunningDiscovery}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
