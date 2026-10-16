import { useState, useEffect, useRef } from 'react';
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
  Unlink
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  loginWithMeta,
  fetchUserPages,
  fetchUserAdAccounts,
  subscribePageWebhook,
  fetchPageLeadForms,
  validateMetaToken,
  exchangeForLongLivedUserToken
} from '../lib/metaSdk';
import Skeleton from './common/Skeleton';
import '../styles/meta.css';

function CustomDropdown({
  value,
  onChange,
  options = [],
  placeholder = 'Select option...',
  searchable = false,
  searchPlaceholder = 'Search...'
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
    <div className="meta-custom-select-wrap" ref={dropdownRef}>
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
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
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
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
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
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_meta_config');
      if (cached) return false;
    } catch (e) { }
    return true;
  });
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
  const [discoveredAdAccounts, setDiscoveredAdAccounts] = useState([]);
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
            connected_account_name: data.connected_account_name || ''
          };
          setConfig(newConf);
          try {
            localStorage.setItem('crm_cached_meta_config', JSON.stringify(newConf));
          } catch (e) { }

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

  if (isLoading) {
    return (
      <div className="meta-container">
        <Skeleton variant="text" width="200px" height="28px" style={{ marginBottom: '16px' }} />
        <Skeleton variant="card" height="180px" />
      </div>
    );
  }

  return (
    <div className="meta-container">
      <div className="meta-inner">
        <div className="meta-master-header">
          <h1 className="meta-master-title">Meta Integration</h1>
        </div>

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
        <div className={`meta-hero-card-container ${config.is_connected ? (tokenHealth.status === 'valid' ? 'is-healthy' : tokenHealth.status === 'expired' ? 'is-broken' : '') : ''}`}>
          {config.is_connected && (config.connected_account_name || config.ad_account_id) && (
            <div className="meta-card-attached-pill">
              <span className="meta-id-pill">
                Ad Account: <strong>{config.connected_account_name || config.ad_account_id}</strong>
              </span>
            </div>
          )}
          <div className="meta-panel-card">
            {config.is_connected ? (
              <div className="meta-account-row">
                <div className="meta-account-identity">
                  <div className="meta-brand-tile">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="#1877F2">
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

        {/* End of Main Content */}
      </div>

      {/* Asset Selection Modal */}
      {isModalOpen && (
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
                <label className="meta-modal-label">Ad Account</label>
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
        </div>
      )}
    </div>
  );
}
