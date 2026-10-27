import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertCircle,
  Plus,
  Trash2,
  X,
  Layers,
  ChevronDown,
  Check,
  Search,
  FileText,
  Eye,
  EyeOff,
  AlertTriangle,
  Key,
  ShieldCheck,
  Unlink,
  MessageCircle,
  Send,
  Phone,
  Zap,
  Mail,
  Globe,
  Monitor,
  ArrowUpRight
} from 'lucide-react';
import EmailIntegrationView from './EmailIntegrationView';
import WebsiteFormsView from './WebsiteFormsView';
import { fetchEmailConfig } from '../lib/email';
import { supabase } from '../lib/supabase';
import {
  loginWithMeta,
  fetchUserPages,
  fetchUserAdAccounts,
  subscribePageWebhook,
  fetchPageLeadForms,
  validateMetaToken,
  exchangeForLongLivedUserToken,
  loginWithWhatsApp,
  fetchUserWhatsAppAccounts,
  fetchAdAccountBudget
} from '../lib/metaSdk';
import {
  testWhatsAppCredentials,
  fetchWhatsAppTemplates,
  sendWhatsAppMessage
} from '../lib/whatsapp';
import Skeleton from './common/Skeleton';
import '../styles/meta.css';

function CustomDropdown({
  value,
  onChange,
  options = [],
  placeholder = 'Select option...',
  searchable = false,
  searchPlaceholder = 'Search...',
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const selectedOption = options.find(o => String(o.value) === String(value));

  const filteredOptions = searchable && search.trim()
    ? options.filter(o =>
      (o.label || '').toLowerCase().includes(search.toLowerCase()) ||
      (o.sublabel || '').toLowerCase().includes(search.toLowerCase())
    )
    : options;

  return (
    <div className={`meta-custom-select-wrap ${className}`} ref={dropdownRef}>
      <button
        type="button"
        className={`meta-custom-select-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(s => !s)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          {selectedOption ? (
            <>
              {selectedOption.badge}
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedOption.label}
              </span>
              {selectedOption.sublabel && (
                <span className="meta-custom-select-sublabel">
                  {selectedOption.sublabel}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: '#94a3b8' }}>{placeholder}</span>
          )}
        </span>
        <ChevronDown size={14} className={`meta-custom-select-arrow ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="meta-custom-select-menu">
          {searchable && (
            <div className="meta-custom-select-search">
              <input
                type="text"
                className="meta-custom-select-search-input"
                placeholder={searchPlaceholder}
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div style={{ padding: '8px', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
              No matches found
            </div>
          ) : (
            filteredOptions.map(opt => {
              const isSelected = String(opt.value) === String(value);
              return (
                <div
                  key={opt.value}
                  className={`meta-custom-select-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearch('');
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    {opt.badge}
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {opt.label}
                    </span>
                    {opt.sublabel && (
                      <span className="meta-custom-select-sublabel">
                        {opt.sublabel}
                      </span>
                    )}
                  </span>
                  {isSelected && <Check size={13} color="#1877F2" style={{ flexShrink: 0 }} />}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const INTEGRATION_CHANNELS = [
  {
    id: 'facebook',
    label: 'Facebook Ads',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    )
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp API',
    icon: <MessageCircle size={20} strokeWidth={1.75} style={{ flexShrink: 0 }} />
  },
  {
    id: 'email',
    label: 'Email',
    icon: <Mail size={20} strokeWidth={1.75} style={{ flexShrink: 0 }} />
  },
  {
    id: 'website',
    label: 'Website Forms',
    icon: <Globe size={20} strokeWidth={1.75} style={{ flexShrink: 0 }} />
  }
];

export default function MetaIntegrationView({ currentUser }) {
  const [config, setConfig] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_meta_config');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) { }
    return {
      app_id: import.meta.env.VITE_META_APP_ID || '',
      app_secret: import.meta.env.VITE_META_APP_SECRET || '',
      access_token: '',
      verify_token: import.meta.env.VITE_META_VERIFY_TOKEN || '',
      ad_account_id: '',
      lead_form_ids: '',
      is_connected: false,
      connected_page_name: '',
      connected_account_name: ''
    };
  });

  const [rowId, setRowId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveError, setSaveError] = useState('');

  // Lead Forms State
  const [forms, setForms] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_connected_forms');
      if (cached) return JSON.parse(cached);
    } catch (e) { }
    return [];
  });
  const [pipelines, setPipelines] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_pipelines');
      if (cached) return JSON.parse(cached);
    } catch (e) { }
    return [];
  });
  const [crmUsers, setCrmUsers] = useState([]);

  // 1-Click Facebook OAuth States
  const [isConnectingFb, setIsConnectingFb] = useState(false);
  const [fbConnectError, setFbConnectError] = useState('');
  const [fbSuccessBanner, setFbSuccessBanner] = useState('');

  // Token Health & Diagnostics
  const [tokenHealth, setTokenHealth] = useState({
    status: 'idle', // 'idle' | 'checking' | 'valid' | 'expired' | 'missing'
    message: '',
    code: null,
    name: ''
  });
  const [isHealthBannerDismissed, setIsHealthBannerDismissed] = useState(false);

  // Manual Credentials Drawer/Card
  const [showManualConfig, setShowManualConfig] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [isTokenFocused, setIsTokenFocused] = useState(false);
  const [isSecretFocused, setIsSecretFocused] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [manualFeedback, setManualFeedback] = useState(null);

  const formatTokenDisplay = (val, isFocused, isRevealed) => {
    if (!val) return '';
    if (isRevealed || isFocused) return val;
    if (val.startsWith('EAA')) {
      return `${val.slice(0, 4)} ••••••••••••••••`;
    }
    return '••••••••••••••••';
  };

  const formatSecretDisplay = (val, isFocused, isRevealed) => {
    if (!val) return '';
    if (isRevealed || isFocused) return val;
    return '••••••••••••••••';
  };

  // Asset Selection Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [discoveredPages, setDiscoveredPages] = useState([]);
  const [discoveredAdAccounts, setDiscoveredAdAccounts] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_discovered_ad_accounts');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [selectedAdAccountId, setSelectedAdAccountId] = useState('');
  const [discoveredForms, setDiscoveredForms] = useState([]);
  const [selectedFormIds, setSelectedFormIds] = useState([]);
  const [isLoadingForms, setIsLoadingForms] = useState(false);
  const [isSubmittingSelection, setIsSubmittingSelection] = useState(false);
  const [fbUserToken, setFbUserToken] = useState('');
  const [pageFormsCache, setPageFormsCache] = useState({});
  const [isScanningPages, setIsScanningPages] = useState(false);

  const [testFeedback, setTestFeedback] = useState(null);
  const feedbackTimerRef = useRef(null);

  // Ad Account Budget & Health State
  const [adBudget, setAdBudget] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_ad_budget');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [isLoadingAdBudget, setIsLoadingAdBudget] = useState(false);

  const formatCurrency = (val, curr = 'INR') => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    try {
      return new Intl.NumberFormat(curr === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: curr,
        maximumFractionDigits: 0,
        minimumFractionDigits: 0
      }).format(Math.round(Number(val)));
    } catch {
      return `${curr} ${Math.round(Number(val)).toLocaleString(curr === 'INR' ? 'en-IN' : 'en-US')}`;
    }
  };

  const formatCompactCurrency = (val, curr = 'INR') => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    const num = Number(val);
    if (curr === 'INR') {
      if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
      if (num >= 100000) return `₹${(num / 100000).toFixed(2)} L`;
      return `₹${Math.round(num).toLocaleString('en-IN')}`;
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(num);
  };

  const loadAdBudget = async () => {
    if (!config.ad_account_id) return;
    setIsLoadingAdBudget(true);
    try {
      const userTok = fbUserToken || localStorage.getItem('crm_meta_user_token');
      const waAccess = config.whatsapp_access_token;
      const b = await fetchAdAccountBudget(
        config.ad_account_id,
        userTok || waAccess || config.access_token,
        [waAccess, config.access_token, userTok]
      );
      if (b) {
        setAdBudget(b);
        try {
          localStorage.setItem('crm_cached_ad_budget', JSON.stringify(b));
        } catch {}
      }
    } catch (err) {
      console.warn('Could not fetch ad budget in MetaIntegrationView:', err);
    } finally {
      setIsLoadingAdBudget(false);
    }
  };

  useEffect(() => {
    if (config.is_connected && config.ad_account_id) {
      loadAdBudget();
    }
  }, [config.is_connected, config.ad_account_id]);

  // Auto-fetch accessible Ad Accounts when connected so switcher is always populated
  useEffect(() => {
    const fetchAccounts = async () => {
      const userTok = fbUserToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('crm_meta_user_token') : null);
      const waAccess = config.whatsapp_access_token;
      const pageTok = config.access_token;
      try {
        const accounts = await fetchUserAdAccounts(userTok, [waAccess, pageTok]);
        if (accounts && accounts.length > 0) {
          setDiscoveredAdAccounts(accounts);
          try {
            localStorage.setItem('crm_cached_discovered_ad_accounts', JSON.stringify(accounts));
          } catch (e) {}
        }
      } catch (e) {
        console.warn('Could not auto-fetch ad accounts:', e);
      }
    };
    if (config.is_connected) {
      fetchAccounts();
    }
  }, [config.is_connected, config.whatsapp_access_token, config.access_token, fbUserToken]);

  const handleSwitchAdAccount = async (newAccountId) => {
    if (!newAccountId) return;
    const cleanId = `act_${String(newAccountId).replace(/^act_/, '')}`;
    if (cleanId === config.ad_account_id) return;

    setIsSwitchingAccount(true);
    const matched = discoveredAdAccounts.find(
      a => String(a.account_id || a.id).replace(/^act_/, '') === String(newAccountId).replace(/^act_/, '')
    );
    const newAccountName = matched?.name || cleanId;

    const updatedConfig = {
      ...config,
      ad_account_id: cleanId,
      connected_account_name: newAccountName
    };
    setConfig(updatedConfig);
    try {
      localStorage.setItem('crm_cached_meta_config', JSON.stringify(updatedConfig));
    } catch (e) {}

    if (rowId) {
      try {
        await supabase
          .from('meta_config')
          .update({
            ad_account_id: cleanId,
            connected_account_name: newAccountName,
            updated_at: new Date().toISOString()
          })
          .eq('id', rowId);
      } catch (err) {
        console.error('Error switching ad account in DB:', err);
      }
    }

    setFbSuccessBanner(`Switched Ad Budget tracking to "${newAccountName}"!`);
    setTimeout(() => setFbSuccessBanner(''), 4000);

    // Refresh budget for this newly selected ad account
    setIsLoadingAdBudget(true);
    try {
      const userTok = fbUserToken || (typeof localStorage !== 'undefined' ? localStorage.getItem('crm_meta_user_token') : null);
      const waAccess = config.whatsapp_access_token;
      const b = await fetchAdAccountBudget(
        cleanId,
        userTok || waAccess || config.access_token,
        [waAccess, config.access_token, userTok]
      );
      if (b) {
        setAdBudget(b);
        try {
          localStorage.setItem('crm_cached_ad_budget', JSON.stringify(b));
        } catch {}
      }
    } catch (err) {
      console.warn('Could not fetch budget after switching ad account:', err);
    } finally {
      setIsLoadingAdBudget(false);
      setIsSwitchingAccount(false);
    }
  };

  // Channel Tab State ('facebook' | 'whatsapp' | 'email' | 'website')
  const [activeChannel, setActiveChannel] = useState('facebook');
  const [visitedChannels, setVisitedChannels] = useState(() => ({
    facebook: true,
    whatsapp: false,
    email: false,
    website: false
  }));

  useEffect(() => {
    setVisitedChannels(prev => prev[activeChannel] ? prev : { ...prev, [activeChannel]: true });
  }, [activeChannel]);

  const [isMobileChannelOpen, setIsMobileChannelOpen] = useState(false);
  const mobileChannelRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (mobileChannelRef.current && !mobileChannelRef.current.contains(e.target)) {
        setIsMobileChannelOpen(false);
      }
    };
    if (isMobileChannelOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isMobileChannelOpen]);

  // WhatsApp Cloud API States
  const [waIsConnected, setWaIsConnected] = useState(false);
  const [waAccountName, setWaAccountName] = useState('');
  const [waPhoneId, setWaPhoneId] = useState('');
  const [waWabaId, setWaWabaId] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waTemplates, setWaTemplates] = useState([]);
  const [previewingWaTemplate, setPreviewingWaTemplate] = useState(null);
  const [isSavingWa, setIsSavingWa] = useState(false);
  const [isTestingWa, setIsTestingWa] = useState(false);
  const [isSyncingWa, setIsSyncingWa] = useState(false);
  const [isConnectingWa, setIsConnectingWa] = useState(false);
  const [waFeedback, setWaFeedback] = useState(null);
  const [waVerifiedInfo, setWaVerifiedInfo] = useState(null);

  // WhatsApp Multi-Account Asset Selection Modal
  const [isWaAssetModalOpen, setIsWaAssetModalOpen] = useState(false);
  const [discoveredWaAccounts, setDiscoveredWaAccounts] = useState([]);
  const [selectedWaAccountKey, setSelectedWaAccountKey] = useState('');
  const [tempWaToken, setTempWaToken] = useState('');

  // WhatsApp Test Message Modal
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [emailConfig, setEmailConfig] = useState(null);
  const [testRecipientPhone, setTestRecipientPhone] = useState('');
  const [testLeadName, setTestLeadName] = useState(() => currentUser?.name || currentUser?.full_name || 'Admin');
  const [testTemplateName, setTestTemplateName] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testModalFeedback, setTestModalFeedback] = useState(null);

  const checkTokenHealth = async (tokenOverride, isManualTest = false) => {
    const targetToken = tokenOverride !== undefined ? tokenOverride : config.access_token;
    if (!targetToken || !targetToken.trim()) {
      setTokenHealth({
        status: 'missing',
        message: 'No access token found. Reconnect with Facebook or paste a token below.',
        code: null,
        name: ''
      });
      if (isManualTest) {
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
        setTestFeedback({ type: 'error', text: 'No token found' });
        feedbackTimerRef.current = setTimeout(() => setTestFeedback(null), 4000);
      }
      return;
    }
    setTokenHealth(prev => ({ ...prev, status: 'checking' }));
    if (isManualTest) {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      setTestFeedback({ type: 'testing', text: 'Testing token...' });
    }
    const res = await validateMetaToken(targetToken.trim());
    if (res.isValid) {
      setIsHealthBannerDismissed(false);
      setTokenHealth({
        status: 'valid',
        message: `Token is active and verified for "${res.name || 'Meta Account'}".`,
        code: null,
        name: res.name || ''
      });
      if (isManualTest) {
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
        setTestFeedback({ type: 'success', text: `Valid for ${res.name || 'Account'}` });
        feedbackTimerRef.current = setTimeout(() => setTestFeedback(null), 4000);
      }
    } else {
      setTokenHealth({
        status: 'expired',
        message: res.message || 'Token is expired or invalid.',
        code: res.code || 190,
        name: ''
      });
      if (isManualTest) {
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
        setTestFeedback({ type: 'error', text: 'Token expired' });
        feedbackTimerRef.current = setTimeout(() => setTestFeedback(null), 4000);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const fetchConfig = async () => {
      try {
        const { data, error } = await supabase
          .from('meta_config')
          .select('*')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!error && data && isMounted) {
          setRowId(data.id);
          const newConf = {
            app_id: data.app_id || import.meta.env.VITE_META_APP_ID || '',
            app_secret: data.app_secret || import.meta.env.VITE_META_APP_SECRET || '',
            access_token: data.access_token || '',
            verify_token: data.verify_token || import.meta.env.VITE_META_VERIFY_TOKEN || '',
            ad_account_id: data.ad_account_id || '',
            lead_form_ids: (data.lead_form_ids || []).join(', '),
            is_connected: data.is_connected || false,
            connected_page_name: data.connected_page_name || '',
            connected_account_name: data.connected_account_name || '',
            whatsapp_access_token: data.whatsapp_access_token || ''
          };
          setConfig(newConf);
          try {
            localStorage.setItem('crm_cached_meta_config', JSON.stringify(newConf));
          } catch (e) { }

          // Populate WhatsApp Cloud API state
          setWaIsConnected(Boolean(data.whatsapp_is_connected || (data.whatsapp_phone_number_id && data.whatsapp_access_token)));
          setWaAccountName(data.whatsapp_account_name || '');
          setWaPhoneId(data.whatsapp_phone_number_id || '');
          setWaWabaId(data.whatsapp_business_account_id || '');
          setWaToken(data.whatsapp_access_token || '');
          if (Array.isArray(data.whatsapp_templates)) {
            setWaTemplates(data.whatsapp_templates);
          }

          if (newConf.access_token) {
            checkTokenHealth(newConf.access_token);
          } else {
            setTokenHealth({ status: 'missing', message: 'No access token configured.', code: null, name: '' });
          }
        }
      } catch (err) {
        console.warn('Error fetching meta_config:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    const fetchConnectedForms = async () => {
      try {
        const { data, error } = await supabase
          .from('connected_forms')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data && isMounted) {
          setForms(data);
          try {
            localStorage.setItem('crm_cached_connected_forms', JSON.stringify(data));
          } catch (e) { }
        }
      } catch (err) {
        console.warn('Error fetching connected_forms:', err);
      }
    };

    const fetchPipelines = async () => {
      try {
        const { data, error } = await supabase
          .from('pipelines')
          .select('*')
          .order('is_default', { ascending: false });
        if (!error && data && isMounted) {
          setPipelines(data);
          try {
            localStorage.setItem('crm_cached_pipelines', JSON.stringify(data));
          } catch (e) { }
        }
      } catch (err) {
        console.warn('Error fetching pipelines:', err);
      }
    };

    const fetchUsers = async () => {
      try {
        const { data, error } = await supabase
          .from('crm_users')
          .select('id, name, email, role')
          .order('name', { ascending: true });
        if (!error && data && isMounted) {
          setCrmUsers(data);
        }
      } catch (err) {
        console.warn('Error fetching users:', err);
      }
    };

    fetchConfig();
    fetchConnectedForms();
    fetchPipelines();
    fetchUsers();
    fetchEmailConfig().then(cfg => {
      if (cfg && isMounted) setEmailConfig(cfg);
    }).catch(() => {});

    // Subscribe to realtime updates for connected_forms
    const formsChannel = supabase
      .channel('connected-forms-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'connected_forms' },
        () => {
          fetchConnectedForms();
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(formsChannel);
    };
  }, []);

  const handleSaveRouting = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setIsSaving(true);
    setSaveStatus(null);
    setSaveError('');

    const validForms = forms.filter(f => f.form_id && f.form_id.trim() !== '');
    const formIdsList = validForms.map(f => f.form_id.trim());

    try {
      if (rowId) {
        await supabase
          .from('meta_config')
          .update({
            lead_form_ids: formIdsList,
            updated_at: new Date().toISOString()
          })
          .eq('id', rowId);
      }

      // Persist connected_forms
      for (const form of validForms) {
        const defaultPipe = pipelines.find(p => p.is_default) || pipelines[0];
        const formPayload = {
          form_id: form.form_id.trim(),
          form_name: (form.form_name || '').trim() || `Form ${form.form_id.trim()}`,
          pipeline_id: form.pipeline_id || defaultPipe?.id || null,
          entry_stage_id: 'new',
          allocation_mode: form.allocation_mode || 'round_robin',
          assigned_to: form.allocation_mode === 'specific_user' ? form.assigned_to : null,
          updated_at: new Date().toISOString()
        };

        if (form.id) {
          await supabase.from('connected_forms').update(formPayload).eq('id', form.id);
        } else {
          const { data: newRow } = await supabase.from('connected_forms').insert([formPayload]).select().single();
          if (newRow) form.id = newRow.id;
        }
      }

      setSaveStatus('success');
    } catch (err) {
      console.error('Error saving form routing:', err);
      setSaveStatus('error');
      setSaveError(err.message || 'Failed to save routing. Please try again.');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  const handleDisconnect = async () => {
    if (!rowId) return;
    setIsSaving(true);
    try {
      await supabase
        .from('meta_config')
        .update({
          is_connected: false,
          connected_page_name: null,
          connected_account_name: null,
          access_token: '',
          ad_account_id: '',
          lead_form_ids: []
        })
        .eq('id', rowId);

      await supabase.from('connected_forms').delete().neq('id', '00000000-0000-0000-0000-000000000000');

      setConfig(prev => ({
        ...prev,
        is_connected: false,
        connected_page_name: '',
        connected_account_name: '',
        access_token: '',
        ad_account_id: '',
        lead_form_ids: ''
      }));
      setForms([]);
      setTokenHealth({ status: 'missing', message: 'No access token configured.', code: null, name: '' });
      setIsHealthBannerDismissed(false);
      setFbConnectError('');
      try {
        localStorage.removeItem('crm_cached_connected_forms');
        localStorage.removeItem('crm_cached_meta_config');
      } catch (e) { }
    } catch (err) {
      console.warn('Error disconnecting:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveManualCredentials = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setIsSavingManual(true);
    setManualFeedback(null);

    const token = config.access_token?.trim() || '';
    const verifyToken = config.verify_token?.trim() || '';
    const appId = config.app_id?.trim() || '';
    const appSecret = config.app_secret?.trim() || '';
    const adAccountId = config.ad_account_id?.trim() || '';

    try {
      const dbPayload = {
        app_id: appId,
        app_secret: appSecret,
        access_token: token,
        verify_token: verifyToken,
        ad_account_id: adAccountId,
        is_connected: Boolean(token),
        updated_at: new Date().toISOString()
      };

      if (rowId) {
        await supabase.from('meta_config').update(dbPayload).eq('id', rowId);
      } else {
        const { data: newRow } = await supabase.from('meta_config').insert([dbPayload]).select().single();
        if (newRow) setRowId(newRow.id);
      }

      setManualFeedback({ type: 'success', message: 'API credentials saved successfully!' });
      await checkTokenHealth(token);
      setTimeout(() => setManualFeedback(null), 4000);
    } catch (err) {
      setManualFeedback({ type: 'error', message: err.message || 'Failed to save credentials.' });
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleConnectWithFacebook = async () => {
    setIsConnectingFb(true);
    setFbConnectError('');
    setFbSuccessBanner('');

    try {
      const targetAppId = config.app_id?.trim() || import.meta.env.VITE_META_APP_ID || '977193864751819';
      const auth = await loginWithMeta(targetAppId);
      const userToken = auth.accessToken;

      // Exchange short-lived login token for long-lived token if app secret available
      const effectiveUserToken = await exchangeForLongLivedUserToken(userToken, targetAppId, config.app_secret);
      setFbUserToken(effectiveUserToken);
      try {
        localStorage.setItem('crm_meta_user_token', effectiveUserToken);
      } catch (e) {}

      // Fetch managed Facebook Pages & Ad Accounts
      const [pages, adAccounts] = await Promise.all([
        fetchUserPages(effectiveUserToken),
        fetchUserAdAccounts(effectiveUserToken)
      ]);

      if (!pages || pages.length === 0) {
        throw new Error('No Facebook Pages found. Make sure your Facebook account has Admin access to your Business Page.');
      }

      setIsScanningPages(true);
      const formsMap = {};
      const scanResults = await Promise.allSettled(
        pages.map(async (page) => {
          const pageToken = page.access_token || userToken;
          const pForms = await fetchPageLeadForms(page.id, pageToken).catch(() => []);
          return { pageId: page.id, forms: pForms };
        })
      );

      scanResults.forEach((res) => {
        if (res.status === 'fulfilled') {
          formsMap[res.value.pageId] = res.value.forms;
        }
      });
      setPageFormsCache(formsMap);

      // Enhance pages with form count and sort pages with active forms to the very top!
      const enhancedPages = pages.map((page) => ({
        ...page,
        formCount: (formsMap[page.id] || []).length
      })).sort((a, b) => b.formCount - a.formCount);

      setDiscoveredPages(enhancedPages);
      setDiscoveredAdAccounts(adAccounts);

      // Default selection to page with the most forms (or first page)
      const defaultPage = enhancedPages[0] || pages[0];
      setSelectedPageId(defaultPage.id);

      // Default ad account if available
      const defaultAdAccount = adAccounts.length > 0 ? (adAccounts[0].account_id || adAccounts[0].id) : '';
      setSelectedAdAccountId(defaultAdAccount);

      // Load forms for default page from cache (start unselected by default)
      const initialForms = formsMap[defaultPage.id] || [];
      setDiscoveredForms(initialForms);
      setSelectedFormIds([]);

      // Open asset selector modal
      setIsModalOpen(true);
    } catch (err) {
      console.error('Facebook connect error:', err);
      setFbConnectError(err.message || 'Failed to connect with Facebook.');
    } finally {
      setIsConnectingFb(false);
      setIsScanningPages(false);
      setIsLoadingForms(false);
    }
  };

  const handleSelectPageChange = (newPageId) => {
    setSelectedPageId(newPageId);
    const cachedForms = pageFormsCache[newPageId] || [];
    setDiscoveredForms(cachedForms);
    setSelectedFormIds([]);
  };

  const handleToggleFormCheck = (formId) => {
    setSelectedFormIds(prev =>
      prev.includes(formId) ? prev.filter(id => id !== formId) : [...prev, formId]
    );
  };

  const handleSelectAllForms = (e) => {
    if (e.target.checked) {
      setSelectedFormIds(discoveredForms.map(f => f.id));
    } else {
      setSelectedFormIds([]);
    }
  };

  const handleConfirmAssetSelection = async () => {
    const selectedPage = discoveredPages.find(p => String(p.id) === String(selectedPageId));
    if (!selectedPage) return;

    setIsSubmittingSelection(true);
    try {
      const targetAppId = config.app_id?.trim() || import.meta.env.VITE_META_APP_ID || '977193864751819';
      const pageToken = selectedPage.access_token || fbUserToken;

      // 1. Subscribe selected page to Leadgen Webhook
      await subscribePageWebhook(selectedPage.id, pageToken);

      // 2. Filter chosen forms
      const chosenForms = discoveredForms.filter(f => selectedFormIds.includes(f.id));

      // 3. Smart Merge forms: preserve existing routing for already configured forms
      const defaultPipe = pipelines.find(p => p.is_default) || pipelines[0];
      const newConnectedForms = [];

      // Delete forms that were unchecked
      const existingInDb = await supabase.from('connected_forms').select('*');
      if (existingInDb.data) {
        for (const ef of existingInDb.data) {
          if (!selectedFormIds.includes(String(ef.form_id))) {
            await supabase.from('connected_forms').delete().eq('id', ef.id);
          }
        }
      }

      for (const rf of chosenForms) {
        const existing = forms.find(f => String(f.form_id) === String(rf.id));
        const payload = {
          form_id: rf.id,
          form_name: rf.name || existing?.form_name || `Form ${rf.id}`,
          pipeline_id: existing?.pipeline_id || defaultPipe?.id || null,
          entry_stage_id: 'new',
          allocation_mode: existing?.allocation_mode || 'round_robin',
          assigned_to: existing?.assigned_to || null,
          updated_at: new Date().toISOString()
        };
        if (existing?.id) {
          await supabase.from('connected_forms').update(payload).eq('id', existing.id);
          newConnectedForms.push({ ...existing, ...payload });
        } else {
          const { data: ins } = await supabase.from('connected_forms').insert([payload]).select().single();
          if (ins) newConnectedForms.push(ins);
        }
      }

      setForms(newConnectedForms);
      try {
        localStorage.setItem('crm_cached_connected_forms', JSON.stringify(newConnectedForms));
      } catch (e) { }

      // 4. Update meta_config with selected Page & Ad Account
      const chosenAdAccount = discoveredAdAccounts.find(
        a => String(a.account_id || a.id) === String(selectedAdAccountId)
      );

      const formIds = chosenForms.map(f => f.id);
      const updatedConfig = {
        ...config,
        app_id: targetAppId,
        access_token: pageToken,
        is_connected: true,
        connected_page_name: selectedPage.name,
        connected_account_name: chosenAdAccount?.name || 'Meta Ads',
        ad_account_id: selectedAdAccountId ? `act_${selectedAdAccountId.replace(/^act_/, '')}` : '',
        lead_form_ids: formIds.join(', ')
      };
      setConfig(updatedConfig);

      const dbConfigPayload = {
        app_id: targetAppId,
        access_token: pageToken,
        is_connected: true,
        connected_page_name: selectedPage.name,
        connected_account_name: chosenAdAccount?.name || 'Meta Ads',
        ad_account_id: selectedAdAccountId ? `act_${selectedAdAccountId.replace(/^act_/, '')}` : '',
        lead_form_ids: formIds,
        updated_at: new Date().toISOString()
      };

      if (rowId) {
        await supabase.from('meta_config').update(dbConfigPayload).eq('id', rowId);
      } else {
        const { data: newRow } = await supabase.from('meta_config').insert(dbConfigPayload).select().single();
        if (newRow) setRowId(newRow.id);
      }

      try {
        localStorage.setItem('crm_cached_meta_config', JSON.stringify(updatedConfig));
      } catch (e) { }

      setIsModalOpen(false);
      setFbConnectError('');
      setIsHealthBannerDismissed(false);
      setTokenHealth({
        status: 'valid',
        message: `Token is active and verified for "${selectedPage.name}".`,
        name: selectedPage.name,
        code: null
      });
      setFbSuccessBanner(`Connected successfully to "${selectedPage.name}" with ${chosenForms.length} form(s)!`);
      setTimeout(() => setFbSuccessBanner(''), 6000);

      // Re-verify in background to confirm live token health
      checkTokenHealth(pageToken);
    } catch (err) {
      console.error('Error confirming asset selection:', err);
      setFbConnectError(err.message || 'Failed to complete connection.');
    } finally {
      setIsSubmittingSelection(false);
    }
  };


  const handleOpenAssetModal = () => {
    const currentFormIds = forms.map(f => String(f.form_id)).filter(Boolean);
    setSelectedFormIds(currentFormIds);

    if (discoveredPages.length > 0 && fbUserToken) {
      const matchingPage = discoveredPages.find(p => p.name === config.connected_page_name);
      if (matchingPage) {
        setSelectedPageId(matchingPage.id);
        const pForms = pageFormsCache[matchingPage.id] || [];
        setDiscoveredForms(pForms);
      }
      setIsModalOpen(true);
    } else {
      handleConnectWithFacebook();
    }
  };

  const handleFormRowChange = (index, field, value) => {
    setForms(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      if (field === 'assigned_to_select') {
        if (value === 'round_robin') {
          item.allocation_mode = 'round_robin';
          item.assigned_to = null;
        } else if (value === 'unassigned') {
          item.allocation_mode = 'unassigned';
          item.assigned_to = null;
        } else {
          item.allocation_mode = 'specific_user';
          item.assigned_to = value;
        }
      } else {
        item[field] = value;
      }
      updated[index] = item;
      return updated;
    });
  };

  const handleRemoveFormRow = async (index) => {
    const target = forms[index];
    const updated = forms.filter((_, i) => i !== index);
    setForms(updated);

    try {
      localStorage.setItem('crm_cached_connected_forms', JSON.stringify(updated));
    } catch (e) { }

    if (target?.id) {
      try {
        await supabase.from('connected_forms').delete().eq('id', target.id);
      } catch (err) {
        console.error('Error deleting form:', err);
      }
    }

    if (rowId) {
      const remainingIds = updated.map(f => f.form_id).filter(Boolean);
      try {
        await supabase.from('meta_config').update({
          lead_form_ids: remainingIds,
          updated_at: new Date().toISOString()
        }).eq('id', rowId);
      } catch (err) {
        console.error('Error updating meta_config:', err);
      }
    }
  };

  // =========================================================================
  // WhatsApp Cloud API Handlers
  // =========================================================================

  const handleConnectWithWhatsApp = async () => {
    setIsConnectingWa(true);
    setWaFeedback(null);

    try {
      const targetAppId = config.app_id?.trim() || import.meta.env.VITE_META_APP_ID || '977193864751819';
      const authResult = await loginWithWhatsApp(targetAppId);
      const userToken = authResult.accessToken;

      // Exchange for long-lived token
      const effectiveToken = await exchangeForLongLivedUserToken(userToken, targetAppId, config.app_secret);
      setTempWaToken(effectiveToken);

      // Check if Meta's Embedded Signup returned the WABA ID & Phone Number ID directly
      if (authResult.embeddedData?.waba_id && authResult.embeddedData?.phone_number_id) {
        await finalizeWhatsAppConnection({
          wabaId: authResult.embeddedData.waba_id,
          phoneId: authResult.embeddedData.phone_number_id,
          verifiedName: 'WhatsApp Business'
        }, effectiveToken);
        return;
      }

      // Otherwise discover WhatsApp Business accounts & phone numbers via Meta Graph API
      const accounts = await fetchUserWhatsAppAccounts(effectiveToken);

      if (accounts.length === 0) {
        // Fallback check against known App WABA/Phone ID
        const targetPhoneId = waPhoneId || config.whatsapp_phone_number_id || '1299473363256876';
        const targetWabaId = waWabaId || config.whatsapp_business_account_id || '1641109674374831';
        try {
          const testRes = await testWhatsAppCredentials({ phoneId: targetPhoneId, token: effectiveToken });
          await finalizeWhatsAppConnection({
            phoneId: targetPhoneId,
            wabaId: targetWabaId,
            verifiedName: testRes.displayName || 'WhatsApp Business',
            displayNumber: testRes.phoneNumber
          }, effectiveToken);
          return;
        } catch (testErr) {
          setWaFeedback({
            type: 'error',
            text: 'Connected with Meta, but no WhatsApp Business accounts were found on this Meta account.'
          });
          return;
        }
      }

      if (accounts.length === 1) {
        await finalizeWhatsAppConnection(accounts[0], effectiveToken);
      } else {
        setDiscoveredWaAccounts(accounts);
        setSelectedWaAccountKey(`${accounts[0].wabaId}:::${accounts[0].phoneId}`);
        setIsWaAssetModalOpen(true);
      }
    } catch (err) {
      console.error('WhatsApp connect error:', err);
      setWaFeedback({
        type: 'error',
        text: err.message || 'Failed to connect with WhatsApp.'
      });
    } finally {
      setIsConnectingWa(false);
    }
  };

  const finalizeWhatsAppConnection = async (account, token) => {
    try {
      const name = account.verifiedName || account.wabaName || 'WhatsApp Business';
      setWaIsConnected(true);
      setWaAccountName(name);
      setWaPhoneId(account.phoneId);
      setWaWabaId(account.wabaId);
      setWaToken(token);

      const dbPayload = {
        whatsapp_is_connected: true,
        whatsapp_account_name: name,
        whatsapp_phone_number_id: account.phoneId,
        whatsapp_business_account_id: account.wabaId,
        whatsapp_access_token: token,
        updated_at: new Date().toISOString()
      };

      if (rowId) {
        await supabase.from('meta_config').update(dbPayload).eq('id', rowId);
      } else {
        const { data: newRow } = await supabase.from('meta_config').insert([dbPayload]).select().single();
        if (newRow) setRowId(newRow.id);
      }

      // Auto-sync templates immediately
      try {
        const templates = await fetchWhatsAppTemplates({ wabaId: account.wabaId, token });
        setWaTemplates(templates);
        if (rowId) {
          await supabase.from('meta_config').update({ whatsapp_templates: templates }).eq('id', rowId);
        }
      } catch (syncErr) {
        console.warn('Initial template sync error:', syncErr);
      }

      setIsWaAssetModalOpen(false);
      setWaFeedback({
        type: 'success',
        text: `Connected successfully to "${name}" (${account.displayNumber || account.phoneId})!`
      });
      setTimeout(() => setWaFeedback(null), 5000);
    } catch (err) {
      setWaFeedback({ type: 'error', text: err.message || 'Failed to finalize WhatsApp connection.' });
    }
  };

  const handleDisconnectWhatsApp = async () => {
    if (!window.confirm('Are you sure you want to disconnect WhatsApp Cloud API? Automated pipeline messages will be paused.')) {
      return;
    }

    setWaIsConnected(false);
    setWaAccountName('');
    setWaPhoneId('');
    setWaWabaId('');
    setWaToken('');
    setWaTemplates([]);
    setWaVerifiedInfo(null);

    try {
      if (rowId) {
        await supabase.from('meta_config').update({
          whatsapp_is_connected: false,
          whatsapp_account_name: '',
          whatsapp_phone_number_id: '',
          whatsapp_business_account_id: '',
          whatsapp_access_token: '',
          whatsapp_templates: [],
          updated_at: new Date().toISOString()
        }).eq('id', rowId);
      }
      setWaFeedback({ type: 'success', text: 'WhatsApp disconnected successfully.' });
      setTimeout(() => setWaFeedback(null), 4000);
    } catch (err) {
      console.error('Error disconnecting WhatsApp:', err);
    }
  };

  const handleSaveWhatsAppCredentials = async () => {
    setIsSavingWa(true);
    setWaFeedback(null);

    try {
      const isConnected = Boolean(waPhoneId.trim() && waToken.trim());
      const accountName = waVerifiedInfo?.displayName || waAccountName || 'WhatsApp Business';
      const dbPayload = {
        whatsapp_is_connected: isConnected,
        whatsapp_account_name: accountName,
        whatsapp_phone_number_id: waPhoneId.trim(),
        whatsapp_business_account_id: waWabaId.trim(),
        whatsapp_access_token: waToken.trim(),
        updated_at: new Date().toISOString()
      };

      if (rowId) {
        const { error } = await supabase.from('meta_config').update(dbPayload).eq('id', rowId);
        if (error) throw error;
      } else {
        const { data: newRow, error } = await supabase.from('meta_config').insert([dbPayload]).select().single();
        if (error) throw error;
        if (newRow) setRowId(newRow.id);
      }

      setWaIsConnected(isConnected);
      setWaAccountName(accountName);

      // If WABA ID is provided, auto-sync templates
      if (waWabaId.trim() && waToken.trim()) {
        try {
          const templates = await fetchWhatsAppTemplates({ wabaId: waWabaId.trim(), token: waToken.trim() });
          setWaTemplates(templates);
          if (rowId) {
            await supabase.from('meta_config').update({ whatsapp_templates: templates }).eq('id', rowId);
          }
        } catch (syncErr) {
          console.warn('Auto template sync error:', syncErr);
        }
      }

      setWaFeedback({ type: 'success', text: `WhatsApp Cloud API credentials saved successfully for "${accountName}"!` });
      setTimeout(() => setWaFeedback(null), 4000);
    } catch (err) {
      setWaFeedback({ type: 'error', text: err.message || 'Failed to save WhatsApp credentials.' });
    } finally {
      setIsSavingWa(false);
    }
  };

  const handleTestWhatsAppConnection = async () => {
    setIsTestingWa(true);
    setWaFeedback(null);
    setWaVerifiedInfo(null);

    try {
      const result = await testWhatsAppCredentials({ phoneId: waPhoneId, token: waToken });
      setWaVerifiedInfo(result);
      setWaFeedback({
        type: 'success',
        text: `Connection verified! Name: ${result.displayName} • Phone: ${result.phoneNumber} • Status: ${result.status}`
      });
    } catch (err) {
      setWaFeedback({
        type: 'error',
        text: `Verification failed: ${err.message}`
      });
    } finally {
      setIsTestingWa(false);
    }
  };

  const handleSyncTemplates = async () => {
    setIsSyncingWa(true);
    setWaFeedback(null);

    try {
      const templates = await fetchWhatsAppTemplates({ wabaId: waWabaId, token: waToken });
      setWaTemplates(templates);

      // Persist templates to database
      if (rowId) {
        await supabase.from('meta_config').update({
          whatsapp_templates: templates,
          updated_at: new Date().toISOString()
        }).eq('id', rowId);
      } else {
        const { data: newRow } = await supabase.from('meta_config').insert([{
          whatsapp_phone_number_id: waPhoneId.trim(),
          whatsapp_business_account_id: waWabaId.trim(),
          whatsapp_access_token: waToken.trim(),
          whatsapp_templates: templates,
          updated_at: new Date().toISOString()
        }]).select().single();
        if (newRow) setRowId(newRow.id);
      }

      setWaFeedback({
        type: 'success',
        text: `Successfully synced ${templates.length} message template${templates.length === 1 ? '' : 's'} from Meta!`
      });
      setTimeout(() => setWaFeedback(null), 5000);
    } catch (err) {
      setWaFeedback({
        type: 'error',
        text: `Template sync failed: ${err.message}`
      });
    } finally {
      setIsSyncingWa(false);
    }
  };

  const handleOpenTestModal = () => {
    setTestModalFeedback(null);
    setTestRecipientPhone('');
    setTestLeadName(currentUser?.name || currentUser?.full_name || 'Admin');
    if (waTemplates.length > 0) {
      setTestTemplateName(waTemplates[0].name);
    } else {
      setTestTemplateName('salado_lead_welcome');
    }
    setIsTestModalOpen(true);
  };

  const handleSendTestMessage = async () => {
    setIsSendingTest(true);
    setTestModalFeedback(null);

    try {
      await sendWhatsAppMessage({
        to: testRecipientPhone,
        leadName: testLeadName,
        templateName: testTemplateName,
        overrideConfig: {
          whatsapp_phone_number_id: waPhoneId,
          whatsapp_access_token: waToken
        }
      });

      setTestModalFeedback({
        type: 'success',
        text: `Test message dispatched successfully to ${testRecipientPhone}!`
      });
      setTimeout(() => {
        setTestModalFeedback(null);
        setIsTestModalOpen(false);
      }, 2500);
    } catch (err) {
      setTestModalFeedback({
        type: 'error',
        text: err.message || 'Failed to send WhatsApp message.'
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  if (isLoading) {
    return (
      <div className="meta-container">
        {/* Mobile Skeleton View (<= 900px) */}
        <div className="meta-mobile-status-view">
          <div className="meta-mobile-status-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Skeleton width="100%" height="48px" borderRadius="8px" />
            <Skeleton width="100%" height="48px" borderRadius="8px" />
            <Skeleton width="100%" height="48px" borderRadius="8px" />
            <Skeleton width="100%" height="48px" borderRadius="8px" />
          </div>
        </div>

        {/* Desktop Full-Featured Skeleton View */}
        <div className="meta-desktop-full-view">
          {/* Left Vertical Channels Sidebar */}
          <aside className="meta-sidebar-pane" aria-label="Integration Channels">
            <ul className="meta-sidebar-list">
              {INTEGRATION_CHANNELS.map((ch) => {
                const isActive = activeChannel === ch.id;
                return (
                  <li key={ch.id}>
                    <button
                      type="button"
                      className={`meta-sidebar-btn ${isActive ? 'active' : ''}`}
                      onClick={() => setActiveChannel(ch.id)}
                    >
                      {ch.icon}
                      <span>{ch.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Right Content Pane Skeleton */}
          <div className="meta-content-pane">
            <div className="meta-inner">
              {/* Section 1: Hero Card Skeleton */}
              <div className="meta-hero-card-container">
                <div className="meta-panel-card" style={{ padding: '20px 24px' }}>
                  <div className="meta-skeleton-hero">
                    <div className="meta-skeleton-hero-left">
                      <Skeleton width="44px" height="44px" borderRadius="10px" />
                      <div className="meta-skeleton-hero-details">
                        <Skeleton width="180px" height="18px" borderRadius="4px" />
                        <Skeleton width="130px" height="12px" borderRadius="3px" style={{ marginTop: 2 }} />
                      </div>
                    </div>
                    <div className="meta-skeleton-hero-actions">
                      <Skeleton width="34px" height="34px" borderRadius="6px" />
                      <Skeleton width="34px" height="34px" borderRadius="6px" />
                      <Skeleton width="34px" height="34px" borderRadius="6px" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 1.5: Ad Budget Card Skeleton */}
              <div className="meta-panel-card" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Skeleton width="32px" height="32px" borderRadius="8px" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <Skeleton width="190px" height="16px" borderRadius="4px" />
                      <Skeleton width="120px" height="12px" borderRadius="3px" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Skeleton width="180px" height="34px" borderRadius="7px" />
                    <Skeleton width="78px" height="34px" borderRadius="7px" />
                  </div>
                </div>

                <div className="meta-budget-hero-box" style={{ marginBottom: 16 }}>
                  <div className="meta-budget-hero-left">
                    <Skeleton width="110px" height="12px" borderRadius="3px" />
                    <div style={{ marginTop: 6 }}>
                      <Skeleton width="150px" height="28px" borderRadius="6px" />
                    </div>
                  </div>
                  <Skeleton width="150px" height="36px" borderRadius="7px" />
                </div>

                <div className="metric-tiles-row">
                  {[1, 2, 3].map(n => (
                    <div key={n} className="metric-tile">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                        <Skeleton width="90px" height="20px" borderRadius="4px" />
                        <Skeleton width="70px" height="11px" borderRadius="3px" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 2: Connected Forms Panel Skeleton */}
              <div className="meta-panel-card" style={{ padding: '20px 24px' }}>
                <div className="meta-skeleton-panel-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="meta-panel-title">Connected Lead Forms</span>
                    <Skeleton width="75px" height="22px" borderRadius="6px" />
                  </div>
                  <Skeleton width="92px" height="32px" borderRadius="6px" />
                </div>

                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1, 2].map((i) => (
                    <div key={i} className="meta-skeleton-panel-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Skeleton width="36px" height="36px" borderRadius="6px" />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <Skeleton width={i === 1 ? '170px' : '210px'} height="15px" borderRadius="4px" />
                          <Skeleton width="95px" height="12px" borderRadius="3px" />
                        </div>
                      </div>
                      <Skeleton width="76px" height="28px" borderRadius="6px" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const websiteFormsCount = forms.filter(f => f.source === 'website').length;
  const isFbConnected = Boolean(config.is_connected && config.access_token);
  const isWaConnected = Boolean(waIsConnected || (waPhoneId.trim() && waToken.trim()));
  const isEmailConnected = Boolean(emailConfig?.is_connected || (emailConfig?.api_key && emailConfig.api_key.trim()));
  const isWebsiteActive = websiteFormsCount > 0;

  const mobileServices = [
    {
      id: 'facebook',
      name: 'Facebook Lead Ads',
      sub: isFbConnected ? (config.connected_page_name || 'Account Connected') : 'Lead Ads sync',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      ),
      iconBg: '#eff6ff',
      iconBorder: '#dbeafe',
      isConnected: isFbConnected,
      statusLabel: isFbConnected ? 'Connected' : 'Not Connected'
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp Cloud API',
      sub: isWaConnected ? (waAccountName || `${waTemplates.length} templates synced`) : 'Cloud API messaging',
      icon: <MessageCircle size={18} style={{ color: '#25D366' }} />,
      iconBg: '#f0fdf4',
      iconBorder: '#bbf7d0',
      isConnected: isWaConnected,
      statusLabel: isWaConnected ? 'Connected' : 'Not Connected'
    },
    {
      id: 'email',
      name: 'Email Integration',
      sub: isEmailConnected ? (emailConfig?.from_email || 'Resend connected') : 'SMTP / Resend API',
      icon: <Mail size={18} style={{ color: '#0284c7' }} />,
      iconBg: '#f0f9ff',
      iconBorder: '#bae6fd',
      isConnected: isEmailConnected,
      statusLabel: isEmailConnected ? 'Connected' : 'Not Connected'
    },
    {
      id: 'website',
      name: 'Website Forms',
      sub: isWebsiteActive ? `${websiteFormsCount} active ${websiteFormsCount === 1 ? 'form' : 'forms'}` : 'Universal embed script',
      icon: <Globe size={18} style={{ color: '#6366f1' }} />,
      iconBg: '#eef2ff',
      iconBorder: '#c7d2fe',
      isConnected: isWebsiteActive,
      statusLabel: isWebsiteActive ? `${websiteFormsCount} Active` : 'Not Set'
    }
  ];

  return (
    <div className="meta-container">
      {/* Mobile 2-Column Status View (Strictly visible on mobile <= 900px) */}
      <div className="meta-mobile-status-view">
        <div className="meta-mobile-status-card">
          <div className="meta-mobile-status-table-header">
            <span className="meta-status-th-service">Service</span>
            <span className="meta-status-th-status">Status</span>
          </div>

          <div className="meta-mobile-status-table-body">
            {mobileServices.map((svc) => (
              <div key={svc.id} className="meta-mobile-status-row">
                <div className="meta-mobile-status-left">
                  <div className="meta-mobile-status-icon-box" style={{ background: svc.iconBg, borderColor: svc.iconBorder }}>
                    {svc.icon}
                  </div>
                  <div className="meta-mobile-status-info">
                    <span className="meta-mobile-status-name">{svc.name}</span>
                    <span className="meta-mobile-status-sub">{svc.sub}</span>
                  </div>
                </div>

                <div className="meta-mobile-status-right">
                  <span className={`meta-mobile-status-badge ${svc.isConnected ? 'is-connected' : 'is-disconnected'}`}>
                    {svc.statusLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Clean Desktop Notice Banner */}
        <div className="meta-mobile-desktop-notice">
          <div className="meta-notice-icon-box">
            <Monitor size={17} strokeWidth={1.75} />
          </div>
          <div className="meta-notice-text-col">
            <span className="meta-notice-title">Desktop Management</span>
            <span className="meta-notice-desc">
              To connect new accounts, configure webhooks, or copy integration scripts, open simplecrm on your computer.
            </span>
          </div>
        </div>
      </div>

      {/* Desktop Full-Featured View (Hidden on mobile <= 900px) */}
      <div className="meta-desktop-full-view">
        {/* Left Vertical Channels Sidebar (Desktop) */}
        <aside className="meta-sidebar-pane" aria-label="Integration Channels">
          <ul className="meta-sidebar-list">
            {INTEGRATION_CHANNELS.map((ch) => {
              const isActive = activeChannel === ch.id;
              return (
                <li key={ch.id}>
                  <button
                    type="button"
                    className={`meta-sidebar-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveChannel(ch.id)}
                  >
                    {ch.icon}
                    <span>{ch.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Channels Content Pane */}
        <div className="meta-content-pane">
          <div className="meta-inner">
        {activeChannel === 'facebook' && (
          <>

            {/* Success / Error Banners */}
            {fbSuccessBanner && (
              <div className="meta-sync-banner success">
                <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                <div>{fbSuccessBanner}</div>
              </div>
            )}

            {fbConnectError && (
              <div className="meta-sync-banner error">
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>{fbConnectError}</div>
                <button
                  type="button"
                  onClick={() => setFbConnectError('')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                >
                  <XCircle size={15} />
                </button>
              </div>
            )}

            {/* Token Expired Warning Banner */}
            {tokenHealth.status === 'expired' && !isHealthBannerDismissed && (
              <div className="meta-sync-banner error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fef2f2' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <AlertCircle size={18} style={{ color: '#dc2626', marginTop: '2px', flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: 'block', fontSize: '13.5px', color: '#991b1b', fontWeight: 600 }}>
                      Meta Access Token Expired (Code {tokenHealth.code || 190})
                    </strong>
                    <span style={{ fontSize: '12px', color: '#b91c1c', display: 'block', marginTop: '2px' }}>
                      {tokenHealth.message || 'Your Meta session has expired. Inbound leads cannot be retrieved until you reconnect or update your token.'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="meta-btn-secondary"
                    onClick={handleConnectWithFacebook}
                    style={{ fontSize: '12px', padding: '6px 12px', backgroundColor: '#ffffff', color: '#991b1b', borderColor: '#fca5a5' }}
                  >
                    Reconnect with Facebook
                  </button>
                  <button
                    type="button"
                    className="meta-btn-secondary"
                    onClick={() => setShowManualConfig(true)}
                    style={{ fontSize: '12px', padding: '6px 12px', backgroundColor: '#ffffff', color: '#475569' }}
                  >
                    Paste Token
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsHealthBannerDismissed(true)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', display: 'flex', alignItems: 'center', padding: '4px' }}
                    title="Dismiss warning"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Section 1: Connected Facebook Account Hero Card */}
            <div className="meta-hero-card-container">
              <div className="meta-panel-card">
                {config.is_connected ? (
                  <>
                    <div className="meta-account-row">
                      <div className="meta-account-identity">
                        <div className="meta-brand-tile">
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="#0f172a">
                            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                          </svg>
                        </div>
                        <div className="meta-account-details">
                          <div className="meta-account-title-line">
                            <span className="meta-account-name">{config.connected_page_name || 'Connected Page'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="meta-account-actions">
                        {testFeedback && (
                          <span className={`meta-inline-feedback ${testFeedback.type}`}>
                            {testFeedback.type === 'testing' && <RefreshCw size={11} className="meta-spin" />}
                            {testFeedback.type === 'success' && <CheckCircle2 size={11} />}
                            {testFeedback.type === 'error' && <AlertCircle size={11} />}
                            <span>{testFeedback.text}</span>
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn-meta-clean btn-meta-icon-only"
                          onClick={() => checkTokenHealth(undefined, true)}
                          disabled={tokenHealth.status === 'checking'}
                          data-tooltip="Test Token"
                          aria-label="Test Token"
                        >
                          <RefreshCw size={15} className={tokenHealth.status === 'checking' ? 'meta-spin' : ''} />
                        </button>
                        <button
                          type="button"
                          className="btn-meta-clean btn-meta-icon-only"
                          onClick={handleOpenAssetModal}
                          disabled={isConnectingFb}
                          data-tooltip="Switch Page / Forms"
                          aria-label="Switch Page / Forms"
                        >
                          <Layers size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-meta-disconnect btn-meta-icon-only"
                          onClick={handleDisconnect}
                          disabled={isSaving}
                          data-tooltip="Disconnect Facebook"
                          data-tooltip-pos="right-edge"
                          aria-label="Disconnect Facebook"
                        >
                          <Unlink size={15} />
                        </button>
                      </div>
                    </div>

                    {(config.connected_account_name || config.ad_account_id) && (
                      <div className="meta-account-footer-row">
                        <span className="meta-id-pill">
                          Ad Account: <strong>{config.connected_account_name || config.ad_account_id}</strong>
                        </span>
                        <span className="meta-connection-status">
                          <span className={`meta-status-dot ${tokenHealth.status === 'expired' ? 'is-expired' : 'is-connected'}`} />
                          {tokenHealth.status === 'expired' ? 'Token Expired' : 'Connected'}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="meta-disconnected-row">
                    <div className="meta-account-identity">
                      <div className="meta-brand-tile muted">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#94a3b8">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                        </svg>
                      </div>
                      <div className="meta-account-details">
                        <span className="meta-account-name">Connect with Facebook</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-meta-facebook-connect"
                      onClick={handleConnectWithFacebook}
                      disabled={isConnectingFb}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                      {isConnectingFb ? 'Connecting...' : 'Connect Facebook'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Section 1.5: Ad Account Budget & Health Panel */}
            {config.is_connected && config.ad_account_id && (
              <div className="meta-panel-card" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className="meta-brand-tile" style={{ width: '32px', height: '32px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#0f172a">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                        Ad Account Budget & Live Status
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '1px' }}>
                        Tracking spend for <strong>{config.connected_account_name || config.ad_account_id}</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {(() => {
                      const currentCleanId = config.ad_account_id?.replace(/^act_/, '') || '';
                      const options = discoveredAdAccounts.map(acc => ({
                        value: String(acc.account_id || acc.id).replace(/^act_/, ''),
                        label: acc.name,
                        sublabel: `(${acc.account_id || acc.id})`
                      }));
                      if (currentCleanId && !options.some(o => o.value === currentCleanId)) {
                        options.unshift({
                          value: currentCleanId,
                          label: config.connected_account_name || currentCleanId,
                          sublabel: `(${currentCleanId})`
                        });
                      }
                      return options.length > 0 ? (
                        <div style={{ minWidth: '220px', maxWidth: '280px' }}>
                          <CustomDropdown
                            value={currentCleanId}
                            onChange={handleSwitchAdAccount}
                            options={options}
                            placeholder="Select Ad Account..."
                            searchable={options.length > 4}
                            className="compact"
                          />
                        </div>
                      ) : null;
                    })()}

                    <button
                      type="button"
                      className="btn-meta-clean"
                      onClick={loadAdBudget}
                      disabled={isLoadingAdBudget || isSwitchingAccount}
                      style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      data-tooltip="Refresh live budget"
                      aria-label="Refresh live budget"
                    >
                      <RefreshCw size={13} className={isLoadingAdBudget || isSwitchingAccount ? 'meta-spin' : ''} />
                      <span>{isLoadingAdBudget || isSwitchingAccount ? 'Syncing...' : 'Refresh'}</span>
                    </button>
                  </div>
                </div>

                {isLoadingAdBudget && !adBudget ? (
                  <>
                    <div className="meta-budget-hero-box" style={{ marginBottom: '16px' }}>
                      <div className="meta-budget-hero-left">
                        <Skeleton width="110px" height="12px" borderRadius="3px" />
                        <div style={{ marginTop: 6 }}>
                          <Skeleton width="150px" height="28px" borderRadius="6px" />
                        </div>
                      </div>
                      <Skeleton width="150px" height="36px" borderRadius="7px" />
                    </div>

                    <div className="metric-tiles-row">
                      {[1, 2, 3].map(n => (
                        <div key={n} className="metric-tile">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                            <Skeleton width="90px" height="20px" borderRadius="4px" />
                            <Skeleton width="70px" height="11px" borderRadius="3px" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="meta-budget-hero-box" style={{ marginBottom: '16px' }}>
                      <div className="meta-budget-hero-left">
                        <span className="meta-budget-hero-label">
                          {adBudget?.fundingSourceDisplay ? 'Available Prepaid Balance' : 'Current Balance'}
                        </span>
                        <div className="meta-budget-hero-val">
                          {adBudget ? (
                            formatCurrency(adBudget.prepaidBalance ?? adBudget.remainingSpendCap ?? 0, adBudget.currency)
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                      <div className="meta-budget-hero-action">
                        <a
                          href={`https://adsmanager.facebook.com/billing_hub/payment_settings?act=${config.ad_account_id.replace(/^act_/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-meta-topup"
                        >
                          <span>Top Up in Ads Manager</span>
                          <ArrowUpRight size={13} />
                        </a>
                      </div>
                    </div>

                    <div className="metric-tiles-row">
                      <div className="metric-tile">
                        <div className="metric-tile-val">
                          {formatCurrency(adBudget?.todayInsights?.spend || 0, adBudget?.currency || 'INR')}
                        </div>
                        <div className="metric-tile-lbl">Today's Ad Spend</div>
                      </div>
                      <div
                        className="metric-tile"
                        data-tooltip={adBudget?.amountSpent ? `Lifetime: ₹${Math.round(adBudget.amountSpent).toLocaleString('en-IN')}` : undefined}
                      >
                        <div className="metric-tile-val">
                          {formatCompactCurrency(adBudget?.amountSpent || 0, adBudget?.currency || 'INR')}
                        </div>
                        <div className="metric-tile-lbl">Lifetime Spend</div>
                      </div>
                      <div className="metric-tile">
                        <div className="metric-tile-val">
                          {adBudget?.accountStatus === 1 ? 'Active' : adBudget?.accountStatus === 3 ? 'Unsettled' : 'Disabled'}
                        </div>
                        <div className="metric-tile-lbl">Account Status</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Section 2: Connected Lead Forms Panel */}
            {config.is_connected && (
              <div className="meta-panel-card">
                <div className="meta-panel-header">
                  <div className="meta-panel-header-left">
                    <span className="meta-panel-title">Connected Lead Forms</span>
                    <span className="meta-count-badge">{forms.length} {forms.length === 1 ? 'form' : 'forms'} active</span>
                  </div>
                  <button
                    type="button"
                    className="btn-meta-add-form"
                    onClick={handleOpenAssetModal}
                  >
                    <Plus size={14} /> Add Form
                  </button>
                </div>

                {forms.length === 0 ? (
                  <div className="meta-forms-empty-state">
                    <FileText size={24} color="#94a3b8" />
                    <p className="meta-empty-title">No lead forms connected</p>
                    <button
                      type="button"
                      className="btn-meta-clean"
                      onClick={handleOpenAssetModal}
                      style={{ marginTop: '8px' }}
                    >
                      <Plus size={13} /> Select Forms
                    </button>
                  </div>
                ) : (
                  <div className="meta-forms-table">
                    {forms.map((form, index) => (
                      <div key={form.id || form.form_id || `form-${index}`} className="meta-form-row-item">
                        <div className="meta-form-identity">
                          <div className="meta-doc-tile">
                            <FileText size={16} color="#475569" />
                          </div>
                          <div className="meta-form-info-col">
                            <span className="meta-form-title">{form.form_name || `Form ${form.form_id}`}</span>
                            <div className="meta-form-meta-row">
                              <span className="meta-id-tag">ID: {form.form_id}</span>
                            </div>
                          </div>
                        </div>

                        <div className="meta-form-actions-col">
                          <button
                            type="button"
                            className="btn-meta-icon-trash"
                            onClick={() => handleRemoveFormRow(index)}
                            data-tooltip="Remove form"
                            data-tooltip-pos="right-edge"
                            aria-label="Remove form"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* =========================================================================
            WhatsApp Cloud API Channel Content
            ========================================================================= */}
        {activeChannel === 'whatsapp' && (
          <>
            {/* Feedback Banners */}
            {waFeedback && (
              <div className={`meta-sync-banner ${waFeedback.type === 'error' ? 'error' : 'success'}`}>
                {waFeedback.type === 'error' ? (
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                ) : (
                  <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                )}
                <div style={{ flex: 1 }}>{waFeedback.text}</div>
                <button
                  type="button"
                  onClick={() => setWaFeedback(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                >
                  <XCircle size={15} />
                </button>
              </div>
            )}

            {/* Section 1: Connected WhatsApp Account Hero Card */}
            <div className="meta-hero-card-container">
              <div className="meta-panel-card">
                {waIsConnected ? (
                  <>
                    <div className="meta-account-row">
                      <div className="meta-account-identity">
                        <div className="meta-brand-tile">
                          <MessageCircle size={22} color="#0f172a" />
                        </div>
                        <div className="meta-account-details">
                          <div className="meta-account-title-line">
                            <span className="meta-account-name">{waAccountName || 'WhatsApp Business'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="meta-account-actions">
                        <button
                          type="button"
                          className="btn-meta-clean btn-meta-icon-only"
                          onClick={handleTestWhatsAppConnection}
                          disabled={isTestingWa}
                          data-tooltip="Test Connection"
                          aria-label="Test Connection"
                        >
                          <RefreshCw size={15} className={isTestingWa ? 'meta-spin' : ''} />
                        </button>
                        <button
                          type="button"
                          className="btn-meta-clean btn-meta-icon-only"
                          onClick={handleConnectWithWhatsApp}
                          disabled={isConnectingWa}
                          data-tooltip="Switch / Reconnect"
                          aria-label="Switch / Reconnect"
                        >
                          <Layers size={15} />
                        </button>
                        <button
                          type="button"
                          className="btn-meta-clean btn-meta-icon-only btn-meta-icon-unlink"
                          onClick={handleDisconnectWhatsApp}
                          data-tooltip="Disconnect"
                          aria-label="Disconnect"
                        >
                          <Unlink size={15} />
                        </button>
                      </div>
                    </div>

                    {(waPhoneId || waWabaId) && (
                      <div className="meta-account-footer-row">
                        <span className="meta-id-pill">
                          {waPhoneId ? 'Phone ID:' : 'WABA ID:'} <strong>{waPhoneId || waWabaId}</strong>
                        </span>
                        <span className="meta-connection-status">
                          <span className="meta-status-dot is-connected" />
                          Connected
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="meta-disconnected-row">
                    <div className="meta-account-identity">
                      <div className="meta-brand-tile muted">
                        <MessageCircle size={24} color="#94a3b8" />
                      </div>
                      <div className="meta-account-details">
                        <span className="meta-account-name">Connect with WhatsApp</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-meta-facebook-connect"
                      onClick={handleConnectWithWhatsApp}
                      disabled={isConnectingWa}
                    >
                      <MessageCircle size={16} color="white" />
                      {isConnectingWa ? 'Connecting...' : 'Connect WhatsApp'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Approved Message Templates Section */}
            <div className="meta-panel-card">
              <div className="meta-panel-header">
                <div className="meta-panel-header-left">
                  <span className="meta-panel-title">Approved Message Templates</span>
                  <span className="meta-count-badge">
                    {waTemplates.length} {waTemplates.length === 1 ? 'template' : 'templates'} active
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-meta-clean"
                    onClick={handleOpenTestModal}
                    disabled={!waPhoneId.trim() || !waToken.trim()}
                    style={{ fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Send size={13} />
                    <span>Test Message</span>
                  </button>

                  <button
                    type="button"
                    className="btn-meta-add-form"
                    onClick={handleSyncTemplates}
                    disabled={isSyncingWa || !waWabaId.trim() || !waToken.trim()}
                  >
                    <RefreshCw size={13} className={isSyncingWa ? 'meta-spin' : ''} />
                    <span>{isSyncingWa ? 'Syncing...' : 'Sync from Meta'}</span>
                  </button>
                </div>
              </div>

              {/* Templates List or Empty State */}
              {waTemplates.length === 0 ? (
                <div className="meta-forms-empty-state">
                  <MessageCircle size={24} color="#94a3b8" />
                  <p className="meta-empty-title">No message templates synced</p>
                  <p style={{ fontSize: '12px', color: '#64748b', maxWidth: '400px', margin: '4px auto 12px auto' }}>
                    Click <strong>Sync from Meta</strong> to fetch your approved WhatsApp message templates.
                  </p>
                  <button
                    type="button"
                    className="btn-meta-clean"
                    onClick={handleSyncTemplates}
                    disabled={isSyncingWa || !waWabaId.trim() || !waToken.trim()}
                    style={{ marginTop: '8px' }}
                  >
                    <RefreshCw size={13} className={isSyncingWa ? 'meta-spin' : ''} />
                    Sync Templates
                  </button>
                </div>
              ) : (
                <div className="meta-templates-table">
                  {waTemplates.map((tmpl) => {
                    const status = (tmpl.status || 'APPROVED').toLowerCase();
                    return (
                      <div
                        key={tmpl.id || tmpl.name}
                        className="meta-template-row-item"
                      >
                        <div className="meta-template-identity">
                          <div className="meta-doc-tile">
                            <MessageCircle size={16} color="#475569" />
                          </div>
                          <div className="meta-template-info-col">
                            <div className="meta-template-name-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="meta-template-name">{tmpl.name}</span>
                              {tmpl.category && (
                                <span className="meta-id-tag" style={{ textTransform: 'lowercase' }}>{tmpl.category}</span>
                              )}
                              {tmpl.language && (
                                <span className="meta-id-tag">{tmpl.language}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="meta-template-status-col" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span className={`meta-template-status-badge ${status}`}>
                            {status === 'approved' && <CheckCircle2 size={12} />}
                            {status === 'rejected' && <XCircle size={12} />}
                            {status === 'pending' && <AlertCircle size={12} />}
                            {tmpl.status || 'APPROVED'}
                          </span>

                          <button
                            type="button"
                            className="btn-meta-clean btn-meta-icon-only"
                            onClick={() => setPreviewingWaTemplate(tmpl)}
                            data-tooltip="View"
                            data-tooltip-pos="right-edge"
                            aria-label={`View ${tmpl.name}`}
                          >
                            <Eye size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Email Integration Channel Content (persisted once visited for instant switching) */}
        {visitedChannels.email && (
          <div style={{ display: activeChannel === 'email' ? 'block' : 'none', width: '100%' }}>
            <EmailIntegrationView currentUser={currentUser} />
          </div>
        )}

        {/* Website Forms Channel Content (persisted once visited for instant switching) */}
        {visitedChannels.website && (
          <div style={{ display: activeChannel === 'website' ? 'block' : 'none', width: '100%' }}>
            <WebsiteFormsView currentUser={currentUser} />
          </div>
        )}

        {/* End of Main Content */}
          </div>
        </div>
      </div>

      {/* Asset Selection Modal */}
      {isModalOpen && createPortal(
        <div className="meta-modal-backdrop" onClick={() => !isSubmittingSelection && setIsModalOpen(false)}>
          <div className="meta-modal" onClick={e => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <h3 className="meta-modal-title">Select Facebook Assets</h3>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => !isSubmittingSelection && setIsModalOpen(false)}
                disabled={isSubmittingSelection}
              >
                <X size={18} />
              </button>
            </div>

            <div className="meta-modal-body">
              {/* Select Page Custom Dropdown */}
              <div className="meta-modal-field">
                <label className="meta-modal-label">Facebook Page</label>
                <CustomDropdown
                  value={selectedPageId}
                  onChange={handleSelectPageChange}
                  options={discoveredPages.map(page => ({
                    value: page.id,
                    label: page.name,
                    badge: page.formCount > 0 ? (
                      <span className="meta-forms-badge-pill">
                        {page.formCount} form{page.formCount > 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="meta-zero-forms-badge">0 forms</span>
                    )
                  }))}
                  searchable={true}
                  searchPlaceholder="Search 25+ Facebook Pages..."
                  placeholder="Select a Facebook Page..."
                />
              </div>

              {/* Select Ad Account Custom Dropdown */}
              <div className="meta-modal-field">
                <label className="meta-modal-label">Ad Account (for Budget & Spend Tracking)</label>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '6px' }}>
                  Select the account where you fund your ad campaigns. Your Facebook Page forms are imported below.
                </div>
                <CustomDropdown
                  value={selectedAdAccountId}
                  onChange={setSelectedAdAccountId}
                  options={[
                    { value: '', label: '-- No Ad Account (Organic / Manual) --' },
                    ...discoveredAdAccounts.map(acc => ({
                      value: acc.account_id || acc.id,
                      label: acc.name,
                      sublabel: `(${acc.account_id || acc.id})`
                    }))
                  ]}
                  searchable={true}
                  searchPlaceholder="Search Ad Accounts..."
                  placeholder="Select an Ad Account..."
                />
              </div>

              {/* Discovered Lead Forms */}
              <div className="meta-modal-field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <label className="meta-modal-label">
                    Lead Forms to Import ({selectedFormIds.length}/{discoveredForms.length})
                  </label>
                  {discoveredForms.length > 0 && (
                    <label style={{ fontSize: '11.5px', color: '#1877F2', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 500 }}>
                      <input
                        type="checkbox"
                        checked={selectedFormIds.length === discoveredForms.length && discoveredForms.length > 0}
                        onChange={handleSelectAllForms}
                        style={{ cursor: 'pointer', accentColor: '#1877F2' }}
                      />
                      Select All
                    </label>
                  )}
                </div>

                {isLoadingForms ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12.5px', color: '#64748b' }}>
                    <RefreshCw size={14} className="meta-spin" style={{ display: 'inline', marginRight: '6px' }} />
                    Loading lead forms from Facebook...
                  </div>
                ) : discoveredForms.length === 0 ? (
                  <div style={{ padding: '18px', textAlign: 'center', fontSize: '12px', color: '#64748b', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                    No lead forms found on this Page. You can still connect and create forms later in Meta Ads Manager.
                  </div>
                ) : (
                  <div className="meta-modal-forms-box">
                    {discoveredForms.map(form => {
                      const isChecked = selectedFormIds.includes(form.id);
                      return (
                        <label key={form.id} className={`meta-modal-form-item ${isChecked ? 'checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleFormCheck(form.id)}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {form.name || `Form ${form.id}`}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>ID: {form.id}</span>
                              {form.status && (
                                <span className="meta-status-pill">
                                  {form.status}
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="meta-modal-footer">
              <button
                type="button"
                className="meta-modal-btn-cancel"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmittingSelection}
              >
                Cancel
              </button>
              <button
                type="button"
                className="meta-modal-btn-confirm"
                onClick={handleConfirmAssetSelection}
                disabled={isSubmittingSelection || !selectedPageId || (discoveredForms.length > 0 && selectedFormIds.length === 0)}
              >
                {isSubmittingSelection
                  ? 'Connecting Selected Page...'
                  : selectedFormIds.length > 0
                    ? `Connect (${selectedFormIds.length} Form${selectedFormIds.length > 1 ? 's' : ''})`
                    : 'Select at least 1 Form'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* WhatsApp Multi-Account Asset Selection Modal */}
      {isWaAssetModalOpen && createPortal(
        <div className="meta-modal-backdrop" onClick={() => setIsWaAssetModalOpen(false)}>
          <div className="meta-modal" style={{ maxWidth: '520px' }} onClick={e => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MessageCircle size={18} color="#25d366" />
                <h3 className="meta-modal-title">Select WhatsApp Number</h3>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => setIsWaAssetModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="meta-modal-body">
              <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '14px', lineHeight: 1.4 }}>
                We discovered multiple WhatsApp Business numbers on your Meta account. Select the phone number to connect to this CRM:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {discoveredWaAccounts.map((acc) => {
                  const key = `${acc.wabaId}:::${acc.phoneId}`;
                  const isSelected = selectedWaAccountKey === key;
                  return (
                    <label
                      key={key}
                      className={`meta-modal-form-item ${isSelected ? 'checked' : ''}`}
                      onClick={() => setSelectedWaAccountKey(key)}
                      style={{ cursor: 'pointer' }}
                    >
                      <input
                        type="radio"
                        name="wa-account-choice"
                        checked={isSelected}
                        onChange={() => setSelectedWaAccountKey(key)}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#0f172a' }}>
                          {acc.verifiedName || acc.wabaName || 'WhatsApp Number'}
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>Phone: {acc.displayNumber}</span>
                          <span>•</span>
                          <span>WABA ID: {acc.wabaId}</span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="meta-modal-footer">
              <button
                type="button"
                className="meta-modal-btn-cancel"
                onClick={() => setIsWaAssetModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="meta-modal-btn-confirm"
                onClick={() => {
                  const chosen =
                    discoveredWaAccounts.find(a => `${a.wabaId}:::${a.phoneId}` === selectedWaAccountKey) ||
                    discoveredWaAccounts[0];
                  if (chosen) finalizeWhatsAppConnection(chosen, tempWaToken);
                }}
                style={{ backgroundColor: '#25D366', borderColor: '#25D366' }}
              >
                Connect Selected Number
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* WhatsApp Live Test Message Modal */}
      {isTestModalOpen && createPortal(
        <div className="meta-modal-backdrop" onClick={() => !isSendingTest && setIsTestModalOpen(false)}>
          <div className="meta-modal meta-test-modal" onClick={e => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MessageCircle size={20} color="#16a34a" />
                  <h3 className="meta-modal-title">Send WhatsApp Test Message</h3>
                </div>
                <p className="meta-modal-subtitle" style={{ marginTop: '4px' }}>
                  Send a live test message to verify delivery, phone formatting, and template placeholders.
                </p>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => !isSendingTest && setIsTestModalOpen(false)}
                disabled={isSendingTest}
              >
                <X size={18} />
              </button>
            </div>

            <div className="meta-modal-body">
              {testModalFeedback && (
                <div className={`meta-sync-banner ${testModalFeedback.type === 'error' ? 'error' : 'success'}`} style={{ margin: 0 }}>
                  {testModalFeedback.type === 'error' ? (
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  ) : (
                    <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, fontSize: '13px' }}>{testModalFeedback.text}</div>
                </div>
              )}

              <div className="meta-modal-field">
                <label className="meta-modal-label">Template</label>
                <CustomDropdown
                  value={testTemplateName}
                  onChange={setTestTemplateName}
                  searchable={true}
                  searchPlaceholder="Search approved templates..."
                  options={
                    waTemplates.length > 0
                      ? waTemplates.map(t => ({
                        value: t.name,
                        label: t.name
                      }))
                      : [{ value: 'salado_lead_welcome', label: 'salado_lead_welcome' }]
                  }
                />
              </div>

              <div className="meta-modal-field">
                <label className="meta-modal-label">
                  Lead Name <span style={{ fontWeight: 400, color: '#64748b' }}>(for <code>&#123;&#123;1&#125;&#125;</code> placeholder)</span>
                </label>
                <input
                  type="text"
                  className="meta-wa-input"
                  placeholder={currentUser?.name || 'Enter name...'}
                  value={testLeadName}
                  onChange={e => setTestLeadName(e.target.value)}
                />
              </div>

              {/* Live WhatsApp Template Preview */}
              {(() => {
                const currentTemplate = waTemplates.find(t => t.name === testTemplateName);
                if (!currentTemplate || !currentTemplate.bodyText) return null;
                const previewBody = currentTemplate.bodyText.replace(/\{\{1\}\}/g, testLeadName.trim() || currentUser?.name || 'John Doe');
                return (
                  <div className="meta-wa-template-preview-bubble">
                    <div className="meta-wa-bubble-label">
                      <MessageCircle size={13} color="#166534" />
                      Template Preview
                    </div>
                    <div className="meta-wa-bubble-text">{previewBody}</div>
                  </div>
                );
              })()}

              <div className="meta-modal-field">
                <label className="meta-modal-label">
                  Recipient Phone Number <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  className="meta-wa-input"
                  placeholder="e.g. 919876543210 or +91 98765 43210"
                  value={testRecipientPhone}
                  onChange={e => setTestRecipientPhone(e.target.value)}
                />
                <span className="meta-wa-hint">Include country code (e.g. 91 for India, 1 for US) with no symbols.</span>
              </div>
            </div>

            <div className="meta-modal-footer">
              <button
                type="button"
                className="meta-modal-btn-cancel"
                onClick={() => setIsTestModalOpen(false)}
                disabled={isSendingTest}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-send-wa-test"
                onClick={handleSendTestMessage}
                disabled={isSendingTest || !testRecipientPhone.trim() || !testTemplateName.trim()}
              >
                {isSendingTest ? (
                  <>
                    <RefreshCw size={15} className="meta-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    Send Test Message
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* WhatsApp Template Message Preview Modal */}
      {previewingWaTemplate && createPortal(
        <div className="meta-modal-backdrop" onClick={() => setPreviewingWaTemplate(null)}>
          <div className="meta-modal" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <h3 className="meta-modal-title">{previewingWaTemplate.name}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                  {previewingWaTemplate.category && (
                    <span className="meta-id-tag" style={{ textTransform: 'lowercase' }}>{previewingWaTemplate.category}</span>
                  )}
                  {previewingWaTemplate.language && (
                    <span className="meta-id-tag">{previewingWaTemplate.language}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="meta-modal-close-btn"
                onClick={() => setPreviewingWaTemplate(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="meta-modal-body" style={{ padding: '20px' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                Template Content
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', fontSize: '13.5px', lineHeight: 1.6, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                {previewingWaTemplate.bodyText || '(No body text defined for this template)'}
              </div>
            </div>

            <div className="meta-modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9' }}>
              <button
                type="button"
                className="btn-meta-clean"
                onClick={() => setPreviewingWaTemplate(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
