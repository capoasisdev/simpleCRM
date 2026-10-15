import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  DownloadCloud,
  ShieldCheck
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Skeleton from './common/Skeleton';
import '../styles/meta.css';

const WEBHOOK_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-webhook`;

export default function MetaIntegrationView({ currentUser }) {
  const isAdmin =
    currentUser?.role === 'admin' ||
    (() => {
      try {
        const sess = localStorage.getItem('simplecrm_user_session');
        return sess ? JSON.parse(sess)?.role === 'admin' : false;
      } catch {
        return false;
      }
    })();

  const [fetchLeadId, setFetchLeadId] = useState('');
  const [isFetchingLead, setIsFetchingLead] = useState(false);
  const [fetchLeadStatus, setFetchLeadStatus] = useState(null);

  const [config, setConfig] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_meta_config');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return {
      app_id: '',
      app_secret: '',
      access_token: '',
      verify_token: '',
      ad_account_id: '',
      lead_form_ids: '',
      is_connected: false,
      connected_page_name: '',
      connected_account_name: '',
      whatsapp_phone_number_id: '',
      whatsapp_business_account_id: '',
      whatsapp_access_token: '',
      whatsapp_template: 'salado_lead_welcome',
      whatsapp_auto_welcome: false
    };
  });

  const [rowId, setRowId] = useState(null);
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('crm_cached_meta_config');
      if (cached) return false;
    } catch (e) {}
    return true;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

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
            connected_account_name: data.connected_account_name || '',
            whatsapp_phone_number_id: data.whatsapp_phone_number_id || '',
            whatsapp_business_account_id: data.whatsapp_business_account_id || '',
            whatsapp_access_token: data.whatsapp_access_token || '',
            whatsapp_template: data.whatsapp_template || 'salado_lead_welcome',
            whatsapp_auto_welcome: Boolean(data.whatsapp_auto_welcome)
          };
          setConfig(newConf);
          try {
            localStorage.setItem('crm_cached_meta_config', JSON.stringify(newConf));
          } catch (e) {}
        }
      } catch (err) {
        console.warn('Error fetching meta_config:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchConfig();
    return () => { isMounted = false; };
  }, []);

  const handleChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    if (saveStatus) setSaveStatus(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus(null);
    setSaveError('');

    const payload = {
      app_id: config.app_id.trim(),
      app_secret: config.app_secret.trim(),
      access_token: config.access_token.trim(),
      verify_token: config.verify_token.trim(),
      ad_account_id: config.ad_account_id.trim(),
      lead_form_ids: (config.lead_form_ids || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      whatsapp_phone_number_id: (config.whatsapp_phone_number_id || '').trim(),
      whatsapp_business_account_id: (config.whatsapp_business_account_id || '').trim(),
      whatsapp_access_token: (config.whatsapp_access_token || '').trim(),
      whatsapp_template: (config.whatsapp_template || '').trim() || 'salado_lead_welcome',
      whatsapp_auto_welcome: Boolean(config.whatsapp_auto_welcome),
      updated_at: new Date().toISOString()
    };

    try {
      let error;
      if (rowId) {
        ({ error } = await supabase
          .from('meta_config')
          .update(payload)
          .eq('id', rowId));
      } else {
        const { data, error: insertError } = await supabase
          .from('meta_config')
          .insert(payload)
          .select()
          .single();
        if (!insertError && data) setRowId(data.id);
        error = insertError;
      }

      if (error) throw error;
      setSaveStatus('success');
    } catch (err) {
      console.error('Error saving meta_config:', err);
      setSaveStatus('error');
      setSaveError(err.message || 'Failed to save. Please try again.');
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
        .update({ is_connected: false, connected_page_name: '', connected_account_name: '' })
        .eq('id', rowId);
      setConfig(prev => ({
        ...prev,
        is_connected: false,
        connected_page_name: '',
        connected_account_name: ''
      }));
    } catch (err) {
      console.warn('Error disconnecting:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(WEBHOOK_BASE).then(() => {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    });
  };

  const handleFetchLeadById = async (e) => {
    if (e) e.preventDefault();
    if (!isAdmin) return;

    const rawId = fetchLeadId.trim();
    if (!rawId) {
      setFetchLeadStatus({
        type: 'error',
        message: 'Please enter a Meta Lead ID.'
      });
      return;
    }

    // Strip any leading 'l:' if user pasted 'l:1425329529014795'
    const cleanLeadId = rawId.replace(/^l:/i, '').trim();

    const token = config.access_token?.trim();
    if (!token) {
      setFetchLeadStatus({
        type: 'error',
        message: 'Meta Access Token is missing. Please save a valid token in API Credentials above.'
      });
      return;
    }

    setIsFetchingLead(true);
    setFetchLeadStatus(null);

    try {
      // 1. Deduplication check: Check if leadgen_id already exists in Supabase
      const { data: existingLead, error: checkErr } = await supabase
        .from('leads')
        .select('id, name, stage')
        .eq('leadgen_id', cleanLeadId)
        .limit(1)
        .maybeSingle();

      if (checkErr) throw new Error(`Database check failed: ${checkErr.message}`);

      if (existingLead) {
        setFetchLeadStatus({
          type: 'info',
          message: `Lead "${existingLead.name}" (ID: ${cleanLeadId}) is already in your CRM in stage "${existingLead.stage}". No duplicate created.`
        });
        setIsFetchingLead(false);
        return;
      }

      // 2. Query Meta Graph API for this specific lead
      const url = `https://graph.facebook.com/v20.0/${cleanLeadId}?access_token=${token}`;
      const res = await fetch(url);
      const mLead = await res.json();

      if (mLead.error) {
        if (mLead.error.code === 190) {
          throw new Error('Meta Access Token has expired. Please update and save your token in API Credentials.');
        }
        throw new Error(mLead.error.message || `Meta API Error (${mLead.error.code})`);
      }

      if (!mLead.id) {
        throw new Error('No lead data returned from Meta for this ID.');
      }

      // 3. Parse field_data
      let leadName = 'Meta Lead';
      let leadEmail = null;
      let leadPhone = null;
      let leadCity = null;
      const customFields = {};
      let firstName = '';
      let lastName = '';

      for (const field of mLead.field_data || []) {
        const rawName = field.name || '';
        const name = rawName.toLowerCase();
        const val = field.values?.[0] || '';

        if (name === 'full_name') {
          leadName = val || leadName;
        } else if (name === 'first_name') {
          firstName = val || '';
        } else if (name === 'last_name') {
          lastName = val || '';
        } else if (name === 'email') {
          leadEmail = val || null;
        } else if (name === 'phone_number' || name === 'phone') {
          leadPhone = val || null;
        } else if (name === 'city') {
          leadCity = val || null;
          customFields['City'] = val;
        } else {
          const cleanLabel = rawName.replace(/_/g, ' ').replace(/\?$/, '?').trim();
          const formattedLabel = cleanLabel.charAt(0).toUpperCase() + cleanLabel.slice(1);
          customFields[formattedLabel] = val;
        }
      }

      if (leadName === 'Meta Lead' && (firstName || lastName)) {
        leadName = `${firstName} ${lastName}`.trim();
      }

      // Deduplication check 2: phone number check
      const normalizedPhone = leadPhone ? leadPhone.replace(/\D/g, '') : null;
      if (normalizedPhone && normalizedPhone.length >= 7) {
        const { data: phoneMatch } = await supabase
          .from('leads')
          .select('id, name')
          .ilike('phone', `%${normalizedPhone.slice(-10)}%`)
          .limit(1)
          .maybeSingle();

        if (phoneMatch) {
          setFetchLeadStatus({
            type: 'info',
            message: `A lead with phone number ${leadPhone} already exists in CRM ("${phoneMatch.name}"). Skipped to prevent duplicate.`
          });
          setIsFetchingLead(false);
          return;
        }
      }

      // 4. Resolve routing assignee
      let defaultAssignee = 'unassigned';
      let routingMode = 'unassigned';
      let activeRules = [];
      let roundRobinIndex = 0;
      let routingConfigId = null;

      try {
        const { data: routingConfig } = await supabase
          .from('lead_routing_config')
          .select('*')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (routingConfig) {
          routingConfigId = routingConfig.id;
          routingMode = routingConfig.mode || 'unassigned';
          defaultAssignee = routingConfig.default_assignee || 'unassigned';
          roundRobinIndex = routingConfig.round_robin_index || 0;
          activeRules = (routingConfig.user_rules || []).filter(r => r.enabled !== false);
        }
      } catch (rErr) {
        console.warn('Could not load lead routing config:', rErr);
      }

      const getNextAssignee = () => {
        if (routingMode === 'unassigned') return 'unassigned';
        if (routingMode === 'single') return defaultAssignee;
        if (routingMode === 'round_robin' && activeRules.length > 0) {
          const sel = activeRules[roundRobinIndex % activeRules.length];
          roundRobinIndex++;
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
        return defaultAssignee;
      };

      // 5. Entry stage from default pipeline
      let entryStage = 'new';
      try {
        const { data: defaultPipe } = await supabase
          .from('pipelines')
          .select('stages')
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (defaultPipe?.stages && Array.isArray(defaultPipe.stages) && defaultPipe.stages.length > 0) {
          const explicitEntry = defaultPipe.stages.find(s => s.is_entry === true);
          const fallbackNew = defaultPipe.stages.find(s => s.id === 'new');
          entryStage = explicitEntry?.id || fallbackNew?.id || defaultPipe.stages[0]?.id || 'new';
        }
      } catch (pErr) {
        console.warn('Could not load default pipeline stage:', pErr);
      }

      const createdDate = mLead.created_time ? new Date(mLead.created_time) : new Date();
      const dateStr = `${String(createdDate.getDate()).padStart(2, '0')}/${String(createdDate.getMonth() + 1).padStart(2, '0')}/${createdDate.getFullYear()}`;
      const assignedTo = getNextAssignee();

      // 6. Insert lead into Supabase
      const { error: insertErr } = await supabase.from('leads').insert({
        name: leadName,
        phone: leadPhone,
        email: leadEmail,
        city: leadCity,
        form_id: mLead.form_id || null,
        form_name: 'Meta Instant Form',
        custom_fields: customFields,
        date: dateStr,
        stage: entryStage,
        assigned_to: assignedTo,
        leadgen_id: cleanLeadId,
        created_at: mLead.created_time || new Date().toISOString()
      });

      if (insertErr) throw new Error(`Database error saving lead: ${insertErr.message}`);

      // Update round robin index in lead_routing_config
      if (routingConfigId && roundRobinIndex > 0) {
        try {
          await supabase.from('lead_routing_config').update({
            round_robin_index: roundRobinIndex,
            updated_at: new Date().toISOString()
          }).eq('id', routingConfigId);
        } catch {}
      }

      setFetchLeadId('');
      setFetchLeadStatus({
        type: 'success',
        message: `Successfully imported "${leadName}" (${leadPhone || 'no phone'}) into stage "${entryStage}" assigned to ${assignedTo}!`
      });
    } catch (err) {
      console.error('Error fetching lead by ID:', err);
      setFetchLeadStatus({
        type: 'error',
        message: err.message || 'Failed to fetch lead from Meta.'
      });
    } finally {
      setIsFetchingLead(false);
    }
  };

  return (
    <div className="meta-container">
      <div className="meta-toolbar">
        <h1 className="meta-main-title">Meta Integration</h1>
        <a
          href="https://developers.facebook.com/apps/"
          target="_blank"
          rel="noopener noreferrer"
          className="meta-ext-link"
        >
          <ExternalLink size={13} strokeWidth={2} />
          Meta Developer Console
        </a>
      </div>

      <form className="meta-body" onSubmit={handleSave}>

        {/* Connection Status */}
        <div className="meta-card">
          <div className="meta-status-row">
            {isLoading ? (
              <div className="meta-status-left">
                <Skeleton width="18px" height="18px" circle />
                <div className="meta-status-text" style={{ gap: '6px' }}>
                  <Skeleton width="90px" height="15px" />
                  <Skeleton width="160px" height="12px" />
                </div>
              </div>
            ) : (
              <div className="meta-status-left fade-in-value">
                {config.is_connected ? (
                  <CheckCircle2 size={18} className="meta-status-icon connected" />
                ) : (
                  <XCircle size={18} className="meta-status-icon disconnected" />
                )}
                <div className="meta-status-text">
                  <span className="meta-status-label">
                    {config.is_connected ? 'Connected' : 'Not Connected'}
                  </span>
                  {config.is_connected && config.connected_page_name && (
                    <span className="meta-status-detail">
                      {config.connected_account_name && `${config.connected_account_name} · `}
                      {config.connected_page_name}
                    </span>
                  )}
                  {!config.is_connected && (
                    <span className="meta-status-detail">
                      Fill in your credentials below and save to enable lead sync.
                    </span>
                  )}
                </div>
              </div>
            )}
            {config.is_connected && (
              <button
                type="button"
                className="meta-disconnect-btn"
                onClick={handleDisconnect}
                disabled={isSaving}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* API Credentials */}
        <div className="meta-card">
          <h2 className="meta-card-title">API Credentials</h2>
          <div className="meta-form-grid">
            <div className="meta-form-row">
              <label className="meta-label">App ID</label>
              <input
                type="text"
                className="meta-input"
                placeholder="e.g. 1234567890"
                value={config.app_id}
                onChange={e => handleChange('app_id', e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="meta-form-row">
              <label className="meta-label">App Secret</label>
              <div className="meta-secret-wrapper">
                <input
                  type={showSecret ? 'text' : 'password'}
                  className="meta-input meta-input-secret"
                  placeholder="App secret from Meta App Dashboard"
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
              <label className="meta-label">
                Access Token
                <span className="meta-label-hint">Long-lived Page or System User token</span>
              </label>
              <div className="meta-secret-wrapper">
                <input
                  type={showToken ? 'text' : 'password'}
                  className="meta-input meta-input-secret"
                  placeholder="EAAxxxxxxxxxxxxx..."
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
                Verify Token
                <span className="meta-label-hint">Custom string you set for webhook verification</span>
              </label>
              <input
                type="text"
                className="meta-input"
                placeholder="e.g. mycrm_verify_abc123"
                value={config.verify_token}
                onChange={e => handleChange('verify_token', e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Ad Account & Lead Forms */}
        <div className="meta-card">
          <h2 className="meta-card-title">Ad Account & Lead Forms</h2>
          <div className="meta-form-grid">
            <div className="meta-form-row">
              <label className="meta-label">
                Ad Account ID
                <span className="meta-label-hint">Found in Meta Business Suite</span>
              </label>
              <input
                type="text"
                className="meta-input"
                placeholder="act_1234567890"
                value={config.ad_account_id}
                onChange={e => handleChange('ad_account_id', e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="meta-form-row">
              <label className="meta-label">
                Lead Form IDs
                <span className="meta-label-hint">Comma-separated, from Instant Forms</span>
              </label>
              <input
                type="text"
                className="meta-input"
                placeholder="123456789, 987654321"
                value={config.lead_form_ids}
                onChange={e => handleChange('lead_form_ids', e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Fetch Lead by Meta ID (Admin Only) */}
        {isAdmin && (
          <div className="meta-card meta-sync-card">
            <div className="meta-sync-header">
              <div className="meta-sync-info">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <h2 className="meta-card-title" style={{ margin: 0 }}>Fetch Lead by Meta ID</h2>
                  <span className="meta-card-badge-admin">
                    <ShieldCheck size={11} /> Admin Only
                  </span>
                </div>
                <p className="meta-webhook-desc" style={{ margin: '4px 0 0 0' }}>
                  Enter a Meta Lead ID (e.g. from Ads Manager <code>l:1425329529014795</code> or <code>1425329529014795</code>) to instantly fetch and import it into the CRM with strict duplicate prevention.
                </p>
              </div>
            </div>

            <div className="meta-fetch-row" style={{ marginTop: '16px' }}>
              <input
                type="text"
                className="meta-input meta-fetch-input"
                placeholder="Enter Lead ID (e.g. 1425329529014795 or l:1425329529014795)"
                value={fetchLeadId}
                onChange={e => setFetchLeadId(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleFetchLeadById(e);
                  }
                }}
                disabled={isFetchingLead}
              />
              <button
                type="button"
                className="meta-sync-btn"
                onClick={handleFetchLeadById}
                disabled={isFetchingLead || !fetchLeadId.trim()}
              >
                <DownloadCloud size={14} className={isFetchingLead ? 'meta-spin' : ''} />
                {isFetchingLead ? 'Fetching Lead...' : 'Fetch & Import Lead'}
              </button>
            </div>

            {fetchLeadStatus && (
              <div className={`meta-sync-banner ${fetchLeadStatus.type}`} style={{ marginTop: '14px' }}>
                {fetchLeadStatus.type === 'success' && (
                  <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                )}
                {fetchLeadStatus.type === 'info' && (
                  <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                )}
                {fetchLeadStatus.type === 'error' && (
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                )}
                <div>{fetchLeadStatus.message}</div>
              </div>
            )}
          </div>
        )}
        {/* Webhook Info */}
        <div className="meta-card">
          <h2 className="meta-card-title">Webhook Configuration</h2>
          <p className="meta-webhook-desc">
            Paste this URL in your Meta App Dashboard under <strong>Webhooks → Leadgen</strong> to receive leads in real-time.
          </p>
          <div className="meta-webhook-url-row">
            <code className="meta-webhook-url">{WEBHOOK_BASE}</code>
            <button
              type="button"
              className="meta-copy-btn"
              onClick={copyWebhookUrl}
            >
              {copiedWebhook ? <Check size={13} /> : <Copy size={13} />}
              {copiedWebhook ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="meta-webhook-note">
            <AlertCircle size={13} />
            The webhook endpoint (Supabase Edge Function) will be set up in a separate step.
          </div>
        </div>

        {/* Save Footer */}
        <div className="meta-footer">
          {saveStatus === 'success' && (
            <span className="meta-save-feedback success">
              <CheckCircle2 size={14} /> Configuration saved.
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="meta-save-feedback error">
              <XCircle size={14} /> {saveError}
            </span>
          )}
          <button
            type="submit"
            className="meta-save-btn"
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>

      </form>
    </div>
  );
}
