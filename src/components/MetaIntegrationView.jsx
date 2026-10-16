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
  ShieldCheck
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
      app_id: '',
      app_secret: '',
      access_token: '',
      verify_token: '',
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

  // Manual Credentials Drawer/Card
  const [showManualConfig, setShowManualConfig] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [manualFeedback, setManualFeedback] = useState(null);

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

  const checkTokenHealth = async (tokenOverride) => {
    const targetToken = tokenOverride !== undefined ? tokenOverride : config.access_token;
    if (!targetToken || !targetToken.trim()) {
      setTokenHealth({
        status: 'missing',
        message: 'No access token found. Reconnect with Facebook or paste a token below.',
        code: null,
        name: ''
      });
      return;
    }
    setTokenHealth(prev => ({ ...prev, status: 'checking' }));
    const res = await validateMetaToken(targetToken.trim());
    if (res.isValid) {
      setTokenHealth({
        status: 'valid',
        message: `Token is active and verified for "${res.name || 'Meta Account'}".`,
        code: null,
        name: res.name || ''
      });
    } else {
      setTokenHealth({
        status: 'expired',
        message: res.message || 'Token is expired or invalid.',
        code: res.code || 190,
        name: ''
      });
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
            app_id: data.app_id || '',
            app_secret: data.app_secret || '',
            access_token: data.access_token || '',
            verify_token: data.verify_token || '',
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
      setFbSuccessBanner(`Connected successfully to "${selectedPage.name}" with ${chosenForms.length} form(s)!`);
      setTimeout(() => setFbSuccessBanner(''), 6000);
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
      <div className="meta-toolbar">
        <div>
          <h1 className="meta-main-title">Meta Integration</h1>
        </div>
      </div>

      <div className="meta-body">

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
        {tokenHealth.status === 'expired' && (
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
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
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
            </div>
          </div>
        )}

        {/* 1-Click Meta Connect Hero */}
        <div className="meta-card meta-hero-card">
          <div className="meta-hero-content">
            <div className="meta-hero-icon-wrap">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
              </svg>
            </div>
            <div className="meta-hero-text">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 className="meta-hero-title">
                  {config.is_connected && config.connected_page_name
                    ? `Connected: ${config.connected_page_name}`
                    : 'Connect with Facebook'}
                </h2>
                {config.is_connected && (
                  tokenHealth.status === 'expired' ? (
                    <span className="meta-hero-badge-expired">
                      <AlertCircle size={12} /> Token Expired
                    </span>
                  ) : tokenHealth.status === 'checking' ? (
                    <span className="meta-hero-badge-checking">
                      <RefreshCw size={11} className="meta-spin" /> Verifying...
                    </span>
                  ) : (
                    <span className="meta-hero-badge-connected">
                      <CheckCircle2 size={12} /> Active
                    </span>
                  )
                )}
              </div>
              {config.is_connected && (config.connected_account_name || config.ad_account_id) && (
                <div style={{ marginTop: '4px', fontSize: '12px', color: '#64748b', fontWeight: 400 }}>
                  Ad Account: {config.connected_account_name || config.ad_account_id}
                </div>
              )}
            </div>

            <div className="meta-hero-actions">
              {config.is_connected ? (
                <>
                  <button
                    type="button"
                    className="meta-btn-secondary"
                    onClick={() => checkTokenHealth()}
                    disabled={tokenHealth.status === 'checking'}
                    title="Test connection with Meta Graph API"
                    style={{ gap: '6px' }}
                  >
                    <RefreshCw size={13} className={tokenHealth.status === 'checking' ? 'meta-spin' : ''} />
                    Test Token
                  </button>
                  <button
                    type="button"
                    className="meta-btn-secondary"
                    onClick={handleOpenAssetModal}
                    disabled={isConnectingFb}
                    title="Change connected Facebook Page, Ad Account, or Lead Forms"
                    style={{ gap: '6px' }}
                  >
                    <Layers size={13} />
                    Switch Page / Forms
                  </button>
                  <button
                    type="button"
                    className="meta-disconnect-btn"
                    onClick={handleDisconnect}
                    disabled={isSaving}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="meta-btn-facebook-login"
                  onClick={handleConnectWithFacebook}
                  disabled={isConnectingFb}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                  {isConnectingFb ? 'Connecting to Facebook...' : 'Continue with Facebook'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Connected Lead Forms (Only shown when connected) */}
        {config.is_connected && (
          <div className="meta-card">
            <div className="meta-forms-header" style={{ marginBottom: '14px' }}>
              <h2 className="meta-card-title" style={{ margin: 0 }}>
                Connected Lead Forms ({forms.length})
              </h2>
              <button
                type="button"
                className="meta-btn-secondary"
                onClick={handleOpenAssetModal}
                style={{ fontSize: '12px', padding: '6px 12px', gap: '6px' }}
              >
                <Plus size={14} /> Add Form
              </button>
            </div>

            {forms.length === 0 ? (
              <div className="meta-forms-empty">
                <FileText size={22} className="meta-forms-empty-icon" />
                <p className="meta-forms-empty-text">No lead forms actively connected</p>
                <p className="meta-forms-empty-sub">
                  Select which Facebook Lead Forms should send leads to your CRM.
                </p>
                <button
                  type="button"
                  className="meta-btn-secondary"
                  onClick={handleOpenAssetModal}
                  style={{ marginTop: '12px', fontSize: '12px', padding: '5px 12px', gap: '4px' }}
                >
                  <Plus size={13} /> Select Forms
                </button>
              </div>
            ) : (
              <div className="meta-forms-list">
                {forms.map((form, index) => (
                  <div key={form.id || form.form_id || `form-${index}`} className="meta-form-item">
                    <div className="meta-form-item-left">
                      <div className="meta-form-icon-box">
                        <FileText size={15} color="#475569" />
                      </div>
                      <div className="meta-form-details">
                        <span className="meta-form-name">
                          {form.form_name || `Form ${form.form_id}`}
                        </span>
                        <span className="meta-form-id-pill">
                          ID: {form.form_id}
                        </span>
                      </div>
                    </div>

                    <div className="meta-form-item-right">
                      <span className="meta-form-status-badge">
                        <span className="meta-form-status-dot"></span>
                        Active
                      </span>
                      <button
                        type="button"
                        className="meta-form-remove-btn"
                        onClick={() => handleRemoveFormRow(index)}
                        title="Remove form from CRM"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Direct API Credentials & Permanent Token (Collapsible) */}
        <div className="meta-card">
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setShowManualConfig(s => !s)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Key size={16} color="#475569" />
              </div>
              <div>
                <h2 className="meta-card-title" style={{ margin: 0, fontSize: '13.5px' }}>
                  Direct API Credentials & Token Management
                </h2>
                <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  Manually paste a permanent System User Token, update App Secret, or view Webhook keys.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="meta-btn-secondary"
              style={{ fontSize: '12px', padding: '5px 12px' }}
              onClick={(e) => { e.stopPropagation(); setShowManualConfig(s => !s); }}
            >
              {showManualConfig ? 'Hide Credentials' : 'Manage Credentials'}
            </button>
          </div>

          {showManualConfig && (
            <form onSubmit={handleSaveManualCredentials} style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid #e2e8f0' }}>
              {manualFeedback && (
                <div className={`meta-sync-banner ${manualFeedback.type}`} style={{ marginBottom: '16px' }}>
                  {manualFeedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <div>{manualFeedback.message}</div>
                </div>
              )}

              <div className="meta-form-grid">
                <div className="meta-form-row">
                  <label className="meta-label">
                    App ID
                    <span className="meta-label-hint">From Meta Developer App</span>
                  </label>
                  <input
                    type="text"
                    className="meta-input"
                    placeholder="977193864751819"
                    value={config.app_id}
                    onChange={e => handleChange('app_id', e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="meta-form-row">
                  <label className="meta-label">
                    App Secret
                    <span className="meta-label-hint">For token exchange</span>
                  </label>
                  <div className="meta-secret-wrapper">
                    <input
                      type={showSecret ? 'text' : 'password'}
                      className="meta-input meta-input-secret"
                      placeholder="••••••••••••••••"
                      value={config.app_secret}
                      onChange={e => handleChange('app_secret', e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="meta-reveal-btn"
                      onClick={() => setShowSecret(s => !s)}
                      tabIndex={-1}
                    >
                      {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div className="meta-form-row meta-full-width">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label className="meta-label" style={{ margin: 0 }}>
                      Access Token
                      <span className="meta-label-hint">System User or Page Access Token</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {tokenHealth.status === 'valid' && (
                        <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} /> Valid for {tokenHealth.name || 'Account'}
                        </span>
                      )}
                      {tokenHealth.status === 'expired' && (
                        <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertCircle size={12} /> Expired (Code {tokenHealth.code || 190})
                        </span>
                      )}
                      <button
                        type="button"
                        className="meta-btn-secondary"
                        onClick={() => checkTokenHealth(config.access_token)}
                        disabled={tokenHealth.status === 'checking'}
                        style={{ fontSize: '11px', padding: '3px 8px', gap: '4px' }}
                      >
                        <RefreshCw size={11} className={tokenHealth.status === 'checking' ? 'meta-spin' : ''} />
                        Test
                      </button>
                    </div>
                  </div>
                  <div className="meta-secret-wrapper">
                    <input
                      type={showToken ? 'text' : 'password'}
                      className="meta-input meta-input-secret"
                      placeholder="EAA..."
                      value={config.access_token}
                      onChange={e => handleChange('access_token', e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="meta-reveal-btn"
                      onClick={() => setShowToken(s => !s)}
                      tabIndex={-1}
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div className="meta-form-row">
                  <label className="meta-label">
                    Webhook Verify Token
                    <span className="meta-label-hint">Must match Meta Webhook configuration</span>
                  </label>
                  <input
                    type="text"
                    className="meta-input"
                    placeholder="saladO@123"
                    value={config.verify_token}
                    onChange={e => handleChange('verify_token', e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="meta-form-row">
                  <label className="meta-label">
                    Ad Account ID
                    <span className="meta-label-hint">e.g. act_945711606807167</span>
                  </label>
                  <input
                    type="text"
                    className="meta-input"
                    placeholder="act_123456789"
                    value={config.ad_account_id}
                    onChange={e => handleChange('ad_account_id', e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="submit"
                  className="meta-btn-secondary"
                  disabled={isSavingManual}
                  style={{ fontSize: '12.5px', padding: '7px 16px', background: '#0f172a', color: '#ffffff', borderColor: '#0f172a' }}
                >
                  {isSavingManual ? 'Saving Credentials...' : 'Save API Credentials'}
                </button>
              </div>
            </form>
          )}
        </div>

      </div>

      {/* Asset Selection Modal */}
      {isModalOpen && (
        <div className="meta-modal-backdrop" onClick={() => !isSubmittingSelection && setIsModalOpen(false)}>
          <div className="meta-modal" onClick={e => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <h3 className="meta-modal-title">Select Facebook Assets</h3>
                <p className="meta-modal-subtitle">Choose the Facebook Page, Ad Account, and forms to link with SimpleCRM.</p>
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
