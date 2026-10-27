import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Key,
  Eye,
  EyeOff,
  Send,
  Plus,
  Trash2,
  Edit2,
  X,
  Check,
  ShieldCheck,
  Unlink,
  ExternalLink,
  RefreshCw,
  FileText,
  Sparkles
} from 'lucide-react';
import {
  fetchEmailConfig,
  saveEmailConfig,
  fetchEmailTemplates,
  saveEmailTemplate,
  deleteEmailTemplate,
  testResendCredentials,
  fetchResendDomains,
  verifyResendApiKey,
  generateTestEmailHtml,
  htmlToPlainText,
  plainTextToHtml,
  RESEND_API_BASE
} from '../lib/email';
import Skeleton from './common/Skeleton';
import '../styles/meta.css';
import '../styles/email.css';

export default function EmailIntegrationView({ currentUser }) {
  const apiKeyInputRef = useRef(null);
  const [config, setConfig] = useState({
    provider: 'resend',
    api_key: '',
    from_name: 'SimpleCRM',
    from_email: 'onboarding@resend.dev',
    reply_to: '',
    is_connected: false
  });
  const [initialConfig, setInitialConfig] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [discoveredDomains, setDiscoveredDomains] = useState([]);
  const [isDetectingDomains, setIsDetectingDomains] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const isDirty = initialConfig && (
    (config.api_key || '').trim() !== (initialConfig.api_key || '').trim() ||
    (config.from_name || '').trim() !== (initialConfig.from_name || '').trim() ||
    (config.from_email || '').trim() !== (initialConfig.from_email || '').trim() ||
    (config.reply_to || '').trim() !== (initialConfig.reply_to || '').trim()
  );

  // Auto-detect domains when API key is provided
  const detectDomains = async (key) => {
    const k = (key || config.api_key || '').trim();
    if (!k || !k.startsWith('re_')) return;
    setIsDetectingDomains(true);
    try {
      const res = await verifyResendApiKey(k);
      if (res.valid && res.domains && res.domains.length > 0) {
        setDiscoveredDomains(res.domains);
        const bestDomain = res.domains[0].name;
        setConfig(prev => {
          if (!prev.from_email || prev.from_email === 'onboarding@resend.dev' || prev.from_email.endsWith('@resend.dev')) {
            return { ...prev, from_email: `notifications@${bestDomain}` };
          }
          return prev;
        });
      }
    } catch (err) {
      console.warn('Could not auto-detect domains:', err);
    } finally {
      setIsDetectingDomains(false);
    }
  };

  const handleApiKeyChange = async (key) => {
    setConfig(prev => ({ ...prev, api_key: key }));
    if (key && key.trim().startsWith('re_')) {
      detectDomains(key.trim());
    }
  };

  // Test Email Modal
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testRecipient, setTestRecipient] = useState(() => currentUser?.email || '');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState(null);

  // Template Modal
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateTab, setTemplateTab] = useState('write'); // 'write' | 'preview'
  const textareaRef = useRef(null);
  const [editingTemplate, setEditingTemplate] = useState({
    id: null,
    name: '',
    subject: '',
    body_text: ''
  });
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Load configuration & templates
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      try {
        const [loadedConfig, loadedTemplates] = await Promise.all([
          fetchEmailConfig(),
          fetchEmailTemplates()
        ]);
        if (isMounted) {
          if (loadedConfig) {
            setConfig(loadedConfig);
            setInitialConfig(loadedConfig);
            if (loadedConfig.api_key && loadedConfig.api_key.trim().startsWith('re_')) {
              verifyResendApiKey(loadedConfig.api_key.trim()).then(res => {
                if (isMounted && res.valid && res.domains && res.domains.length > 0) {
                  setDiscoveredDomains(res.domains);
                  setConfig(prev => {
                    if (!prev.from_email || prev.from_email === 'onboarding@resend.dev' || prev.from_email.endsWith('@resend.dev')) {
                      return { ...prev, from_email: `notifications@${res.domains[0].name}` };
                    }
                    return prev;
                  });
                }
              });
            }
          }
          if (Array.isArray(loadedTemplates)) setTemplates(loadedTemplates);
        }
      } catch (err) {
        console.error('Error loading email integration data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);

  // Save Settings
  const handleSaveSettings = async (overrideConfig) => {
    const toSave = overrideConfig || config;
    setIsSaving(true);
    setFeedback(null);
    try {
      let isConnected = false;
      if (toSave.api_key && toSave.api_key.trim()) {
        const testRes = await verifyResendApiKey(toSave.api_key.trim());
        if (!testRes.valid) {
          setFeedback({
            type: 'error',
            text: `Resend API key verification failed: ${testRes.error}`
          });
          setIsSaving(false);
          return;
        }
        isConnected = true;
      }

      const updated = {
        ...toSave,
        is_connected: isConnected
      };

      const saved = await saveEmailConfig(updated);
      setConfig(saved);
      setInitialConfig(saved);
      setFeedback({
        type: 'success',
        text: isConnected
          ? 'Resend API key verified & settings saved successfully.'
          : 'Email settings saved.'
      });
    } catch (err) {
      setFeedback({ type: 'error', text: 'Failed to save email settings: ' + err.message });
    } finally {
      setIsSaving(false);
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Resend email integration? Automated stage emails will be paused.')) return;
    const resetConfig = {
      ...config,
      api_key: '',
      is_connected: false
    };
    await handleSaveSettings(resetConfig);
  };

  // Live Test Email
  const handleSendTestEmail = async (e) => {
    e.preventDefault();
    if (!testRecipient || !testRecipient.trim()) return;

    setIsSendingTest(true);
    setTestFeedback(null);
    try {
      const response = await fetch(`${RESEND_API_BASE}/emails`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `${config.from_name || 'SimpleCRM'} <${config.from_email || 'onboarding@resend.dev'}>`,
          to: [testRecipient.trim()],
          reply_to: config.reply_to?.trim() || undefined,
          subject: `✓ Connection Verified - ${config.from_name || 'SimpleCRM'}`,
          html: generateTestEmailHtml({
            senderName: config.from_name,
            senderEmail: config.from_email,
            replyTo: config.reply_to,
            testRecipient: testRecipient.trim()
          })
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Resend error response');
      }

      setTestFeedback({
        type: 'success',
        text: `Test email dispatched! Resend ID: ${data.id}`
      });
      setFeedback({
        type: 'success',
        text: `Test email dispatched successfully to ${testRecipient.trim()}!`
      });

      // Auto-close modal after brief confirmation
      setTimeout(() => {
        setIsTestModalOpen(false);
        setTestFeedback(null);
      }, 1400);
    } catch (err) {
      setTestFeedback({
        type: 'error',
        text: 'Failed to send test email: ' + err.message
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  // Save Template
  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    if (!editingTemplate.name?.trim() || !editingTemplate.subject?.trim() || !editingTemplate.body_text?.trim()) {
      alert('Please fill in all template fields.');
      return;
    }

    setIsSavingTemplate(true);
    try {
      const payload = {
        id: editingTemplate.id,
        name: editingTemplate.name.trim(),
        subject: editingTemplate.subject.trim(),
        body_html: plainTextToHtml(editingTemplate.body_text)
      };
      const saved = await saveEmailTemplate(payload);
      setTemplates(prev => {
        const exists = prev.some(t => t.id === saved.id);
        if (exists) return prev.map(t => t.id === saved.id ? saved : t);
        return [...prev, saved];
      });
      setIsTemplateModalOpen(false);
      setFeedback({ type: 'success', text: `Template "${saved.name}" saved.` });
    } catch (err) {
      alert('Failed to save template: ' + err.message);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  // Delete Template
  const handleDeleteTemplate = async (id, name) => {
    if (!window.confirm(`Delete email template "${name}"?`)) return;
    try {
      await deleteEmailTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      setFeedback({ type: 'success', text: `Template "${name}" deleted.` });
    } catch (err) {
      alert('Failed to delete template');
    }
  };

  // Cursor-aware Insert Variable helper
  const insertVariable = (tag) => {
    const el = textareaRef.current;
    if (!el) {
      setEditingTemplate(prev => ({
        ...prev,
        body_text: (prev.body_text || '') + ' ' + tag + ' '
      }));
      return;
    }

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = editingTemplate.body_text || '';
    const newText = current.substring(0, start) + tag + current.substring(end);

    setEditingTemplate(prev => ({
      ...prev,
      body_text: newText
    }));

    setTimeout(() => {
      el.focus();
      const newPos = start + tag.length;
      el.setSelectionRange(newPos, newPos);
    }, 0);
  };

  // Live Preview Helpers
  const sampleData = {
    '{{name}}': 'John Doe',
    '{{company}}': 'Acme Corporation',
    '{{phone}}': '+1 (555) 234-5678',
    '{{stage}}': 'Proposal Sent'
  };

  const getPreviewSubject = () => {
    let s = editingTemplate.subject || '';
    Object.entries(sampleData).forEach(([k, v]) => {
      s = s.replaceAll(k, v);
    });
    return s || '(No subject line)';
  };

  const getPreviewHtml = () => {
    let text = editingTemplate.body_text || '';
    Object.entries(sampleData).forEach(([k, v]) => {
      text = text.replaceAll(k, `<span class="email-preview-merge-tag">${v}</span>`);
    });
    return plainTextToHtml(text);
  };

  if (isLoading) {
    return (
      <div className="email-view-container">
        {/* SECTION 1: HERO STATUS CARD SKELETON */}
        <div className="meta-panel-card">
          <div className="meta-account-row">
            <div className="meta-account-identity">
              <Skeleton width="44px" height="44px" borderRadius="8px" />
              <div className="meta-account-details" style={{ gap: '6px' }}>
                <Skeleton width="180px" height="20px" borderRadius="4px" />
              </div>
            </div>
            <div className="meta-account-actions">
              <Skeleton width="34px" height="34px" borderRadius="7px" />
              <Skeleton width="34px" height="34px" borderRadius="7px" />
            </div>
          </div>
          <div className="meta-account-footer-row">
            <Skeleton width="160px" height="14px" borderRadius="4px" />
            <Skeleton width="80px" height="14px" borderRadius="4px" />
          </div>
        </div>

        {/* SECTION 2: CREDENTIALS & SENDER CONFIGURATION SKELETON */}
        <div className="meta-panel-card">
          <div className="meta-panel-header">
            <div className="meta-panel-header-left">
              <Skeleton width="220px" height="16px" borderRadius="4px" />
            </div>
            <Skeleton width="130px" height="30px" borderRadius="7px" />
          </div>

          <div style={{ padding: '8px 24px 20px 24px' }}>
            <table className="email-kv-table">
              <tbody>
                <tr className="email-kv-row">
                  <td className="email-kv-key-col">
                    <Skeleton width="115px" height="14px" borderRadius="4px" />
                  </td>
                  <td className="email-kv-val-col">
                    <Skeleton width="100%" height="40px" borderRadius="8px" />
                  </td>
                </tr>
                <tr className="email-kv-row">
                  <td className="email-kv-key-col">
                    <Skeleton width="80px" height="14px" borderRadius="4px" />
                  </td>
                  <td className="email-kv-val-col">
                    <Skeleton width="100%" height="40px" borderRadius="8px" />
                  </td>
                </tr>
                <tr className="email-kv-row">
                  <td className="email-kv-key-col">
                    <Skeleton width="135px" height="14px" borderRadius="4px" />
                  </td>
                  <td className="email-kv-val-col">
                    <Skeleton width="100%" height="40px" borderRadius="8px" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                      <Skeleton width="90px" height="13px" borderRadius="4px" />
                      <Skeleton width="140px" height="22px" borderRadius="12px" />
                    </div>
                  </td>
                </tr>
                <tr className="email-kv-row">
                  <td className="email-kv-key-col">
                    <Skeleton width="90px" height="14px" borderRadius="4px" />
                  </td>
                  <td className="email-kv-val-col">
                    <Skeleton width="100%" height="40px" borderRadius="8px" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION 3: EMAIL TEMPLATES SKELETON */}
        <div className="meta-panel-card">
          <div className="meta-panel-header">
            <div className="meta-panel-header-left">
              <Skeleton width="190px" height="16px" borderRadius="4px" />
              <Skeleton width="26px" height="18px" borderRadius="10px" />
            </div>
            <Skeleton width="130px" height="32px" borderRadius="6px" />
          </div>

          <div className="meta-forms-table">
            {[1, 2].map((i) => (
              <div key={i} className="meta-form-row-item">
                <div className="meta-form-identity">
                  <Skeleton width="36px" height="36px" borderRadius="8px" />
                  <div className="meta-form-info-col" style={{ width: '100%', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Skeleton width={i === 1 ? '130px' : '160px'} height="15px" borderRadius="4px" />
                      <Skeleton width={i === 1 ? '160px' : '140px'} height="18px" borderRadius="10px" />
                    </div>
                  </div>
                </div>
                <div className="meta-form-actions-col">
                  <Skeleton width="30px" height="30px" borderRadius="6px" />
                  <Skeleton width="30px" height="30px" borderRadius="6px" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="email-view-container">
      {/* Feedback Banner */}
      {feedback && (
        <div className={`email-sync-banner ${feedback.type === 'error' ? 'error' : 'success'}`}>
          {feedback.type === 'error' ? (
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
          ) : (
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
          )}
          <div style={{ flex: 1 }}>{feedback.text}</div>
          <button
            type="button"
            className="email-sync-banner-close"
            onClick={() => setFeedback(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* SECTION 1: HERO STATUS CARD */}
      <div className="meta-panel-card">
        {config.is_connected ? (
          <>
            <div className="meta-account-row">
              <div className="meta-account-identity">
                <div className="meta-brand-tile">
                  <Mail size={22} color="#0f172a" />
                </div>
                <div className="meta-account-details">
                  <div className="meta-account-title-line">
                    <span className="meta-account-name">Resend Email Engine</span>
                  </div>
                </div>
              </div>

              <div className="meta-account-actions">
                <button
                  type="button"
                  className="btn-meta-clean btn-meta-icon-only"
                  onClick={() => {
                    setTestFeedback(null);
                    setIsTestModalOpen(true);
                  }}
                  disabled={!config.api_key}
                  data-tooltip="Send Test Email"
                  aria-label="Send Test Email"
                >
                  <Send size={15} />
                </button>

                <button
                  type="button"
                  className="btn-meta-disconnect btn-meta-icon-only"
                  onClick={handleDisconnect}
                  data-tooltip="Disconnect Resend"
                  data-tooltip-pos="right-edge"
                  aria-label="Disconnect Resend"
                >
                  <Unlink size={15} />
                </button>
              </div>
            </div>

            <div className="meta-account-footer-row">
              <span className="meta-id-pill">
                Sender: <strong>{config.from_email || 'Not configured'}</strong>
              </span>
              <span className="meta-connection-status">
                <span className="meta-status-dot is-connected" />
                Connected
              </span>
            </div>
          </>
        ) : (
          <div className="meta-disconnected-row">
            <div className="meta-account-identity">
              <div className="meta-brand-tile muted">
                <Mail size={22} />
              </div>
              <div className="meta-account-details">
                <span className="meta-account-name">Connect Resend Email</span>
              </div>
            </div>

            <button
              type="button"
              className="btn-meta-facebook-connect"
              onClick={() => {
                if (apiKeyInputRef.current) {
                  apiKeyInputRef.current.focus();
                }
              }}
            >
              <Key size={14} />
              <span>Enter API Key</span>
            </button>
          </div>
        )}
      </div>

      {/* SECTION 2: CREDENTIALS & SENDER CONFIGURATION */}
      <div className="meta-panel-card">
        <div className="meta-panel-header">
          <div className="meta-panel-header-left">
            <span className="meta-panel-title">API Credentials & Sender Profile</span>
          </div>
          <a
            href="https://resend.com/api-keys"
            target="_blank"
            rel="noreferrer"
            className="btn-meta-clean"
            style={{ height: '30px', padding: '0 10px', fontSize: '12px', gap: '5px' }}
          >
            <span>Get Resend API Key</span>
            <ExternalLink size={12} />
          </a>
        </div>

        <div style={{ padding: '8px 24px 20px 24px' }}>
          <table className="email-kv-table">
            <tbody>
              {/* Row 1: Resend API Key */}
              <tr className="email-kv-row">
                <td className="email-kv-key-col">
                  <span className="email-kv-label">
                    Resend API Key <span style={{ color: '#ef4444' }}>*</span>
                  </span>
                </td>
                <td className="email-kv-val-col">
                  <div className="email-kv-input-wrapper">
                    <input
                      ref={apiKeyInputRef}
                      type={showKey ? 'text' : 'password'}
                      className="email-kv-input"
                      placeholder="re_123456789_abcdef..."
                      value={config.api_key}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      style={{ fontFamily: showKey ? 'inherit' : 'monospace', paddingRight: '40px' }}
                    />
                    <button
                      type="button"
                      className="email-kv-icon-btn"
                      onClick={() => setShowKey(!showKey)}
                      title={showKey ? 'Hide key' : 'Show key'}
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </td>
              </tr>

              {/* Row 2: From Name */}
              <tr className="email-kv-row">
                <td className="email-kv-key-col">
                  <span className="email-kv-label">From Name</span>
                </td>
                <td className="email-kv-val-col">
                  <input
                    type="text"
                    className="email-kv-input"
                    placeholder="e.g. SimpleCRM or Pranav Patil"
                    value={config.from_name}
                    onChange={(e) => setConfig({ ...config, from_name: e.target.value })}
                  />
                </td>
              </tr>

              {/* Row 3: From Email Address */}
              <tr className="email-kv-row">
                <td className="email-kv-key-col">
                  <span className="email-kv-label">From Email Address</span>
                </td>
                <td className="email-kv-val-col">
                  <input
                    type="email"
                    className="email-kv-input"
                    placeholder="e.g. notifications@yourdomain.com"
                    value={config.from_email}
                    onChange={(e) => setConfig({ ...config, from_email: e.target.value })}
                  />
                  {discoveredDomains.length > 0 && (
                    <div className="email-verified-domains-row">
                      <span className="email-verified-domains-label">Verified domains:</span>
                      <div className="email-verified-domains-scroll">
                        {discoveredDomains.map((d) => {
                          const domainName = typeof d === 'string' ? d : d.name;
                          const emailOpt = `notifications@${domainName}`;
                          const isSelected = config.from_email === emailOpt || config.from_email?.endsWith(`@${domainName}`);
                          return (
                            <button
                              key={domainName}
                              type="button"
                              className={`email-domain-pill ${isSelected ? 'active' : ''}`}
                              onClick={() => setConfig(prev => ({ ...prev, from_email: emailOpt }))}
                              title={`Select ${emailOpt}`}
                            >
                              {isSelected && <Check size={11} strokeWidth={2.5} />}
                              <span>{domainName}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </td>
              </tr>

              {/* Row 4: Reply-To Email */}
              <tr className="email-kv-row">
                <td className="email-kv-key-col">
                  <span className="email-kv-label">Reply-To Email</span>
                </td>
                <td className="email-kv-val-col">
                  <input
                    type="email"
                    className="email-kv-input"
                    placeholder="e.g. sales@yourcompany.com or support@yourcompany.com"
                    value={config.reply_to}
                    onChange={(e) => setConfig({ ...config, reply_to: e.target.value })}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          {isDirty && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
              <button
                type="button"
                className="btn-meta-add-form"
                onClick={() => handleSaveSettings()}
                disabled={isSaving}
                style={{ height: '34px', padding: '0 16px' }}
              >
                <Check size={14} strokeWidth={2.5} />
                <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 3: EMAIL TEMPLATES */}
      <div className="meta-panel-card">
        <div className="meta-panel-header">
          <div className="meta-panel-header-left">
            <span className="meta-panel-title">Automated Email Templates</span>
            <span className="meta-count-badge">
              {templates.length} {templates.length === 1 ? 'template' : 'templates'}
            </span>
          </div>
          <button
            type="button"
            className="btn-meta-add-form"
            onClick={() => {
              setEditingTemplate({
                id: null,
                name: '',
                subject: '',
                body_text: 'Hi {{name}},\n\nThank you for connecting with us. We have received your inquiry and our team is reviewing your requirements.\n\nBest regards,\nThe Team'
              });
              setTemplateTab('write');
              setIsTemplateModalOpen(true);
            }}
          >
            <Plus size={14} /> Create Template
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="meta-forms-empty-state">
            <Mail size={24} color="#94a3b8" />
            <p className="meta-empty-title">No email templates created yet</p>
            <button
              type="button"
              className="btn-meta-clean"
              onClick={() => {
                setEditingTemplate({
                  id: null,
                  name: '',
                  subject: '',
                  body_text: 'Hi {{name}},\n\nThank you for connecting with us. We have received your inquiry and our team is reviewing your requirements.\n\nBest regards,\nThe Team'
                });
                setTemplateTab('write');
                setIsTemplateModalOpen(true);
              }}
              style={{ marginTop: '8px' }}
            >
              <Plus size={13} /> Create Template
            </button>
          </div>
        ) : (
          <div className="meta-forms-table">
            {templates.map(tmpl => {
              return (
                <div key={tmpl.id} className="meta-form-row-item">
                  <div className="meta-form-identity">
                    <div className="meta-doc-tile">
                      <Mail size={16} color="#475569" />
                    </div>
                    <div className="meta-form-info-col">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className="meta-form-title">{tmpl.name}</span>
                        {tmpl.subject && (
                          <span className="meta-id-tag">Subject: {tmpl.subject}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="meta-form-actions-col">
                    <button
                      type="button"
                      className="btn-meta-clean btn-meta-icon-only"
                      onClick={() => {
                        setEditingTemplate({
                          id: tmpl.id,
                          name: tmpl.name,
                          subject: tmpl.subject,
                          body_text: htmlToPlainText(tmpl.body_html || '')
                        });
                        setTemplateTab('preview');
                        setIsTemplateModalOpen(true);
                      }}
                      data-tooltip="Preview"
                      aria-label={`Preview ${tmpl.name}`}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-meta-clean btn-meta-icon-only"
                      onClick={() => {
                        setEditingTemplate({
                          id: tmpl.id,
                          name: tmpl.name,
                          subject: tmpl.subject,
                          body_text: htmlToPlainText(tmpl.body_html || '')
                        });
                        setTemplateTab('write');
                        setIsTemplateModalOpen(true);
                      }}
                      data-tooltip="Edit template"
                      aria-label={`Edit ${tmpl.name}`}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-meta-icon-trash"
                      onClick={() => handleDeleteTemplate(tmpl.id, tmpl.name)}
                      data-tooltip="Delete template"
                      data-tooltip-pos="right-edge"
                      aria-label={`Delete ${tmpl.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: TEST EMAIL MODAL */}
      {isTestModalOpen && createPortal(
        <div className="email-modal-backdrop" onClick={() => setIsTestModalOpen(false)}>
          <div className="email-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="email-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Send size={16} color="#0284c7" />
                <h3 className="email-modal-title">Send Test Email</h3>
              </div>
              <button
                type="button"
                className="email-sync-banner-close"
                onClick={() => setIsTestModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSendTestEmail}>
              <div className="email-modal-body">
                {testFeedback && (
                  <div className={`email-sync-banner ${testFeedback.type === 'error' ? 'error' : 'success'}`} style={{ margin: 0 }}>
                    {testFeedback.type === 'error' ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
                    <div style={{ flex: 1, fontSize: '12.5px' }}>{testFeedback.text}</div>
                  </div>
                )}

                <div className="email-field-group">
                  <label className="email-field-label">Recipient Email Address</label>
                  <input
                    type="email"
                    required
                    className="email-input"
                    placeholder="you@company.com"
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                  />
                  <span className="email-field-hint">
                    A test verification email will be dispatched via Resend.
                  </span>
                </div>
              </div>

              <div className="email-modal-footer">
                <button
                  type="button"
                  className="btn-email-secondary"
                  onClick={() => {
                    setIsTestModalOpen(false);
                    setTestFeedback(null);
                  }}
                >
                  {testFeedback?.type === 'success' ? 'Close' : 'Cancel'}
                </button>
                {testFeedback?.type !== 'success' && (
                  <button
                    type="submit"
                    className="btn-email-primary"
                    disabled={isSendingTest || !testRecipient}
                  >
                    <Send size={13} />
                    <span>{isSendingTest ? 'Sending...' : 'Send Test Email'}</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 2: CREATE / EDIT TEMPLATE MODAL */}
      {isTemplateModalOpen && createPortal(
        <div className="email-modal-backdrop" onClick={() => setIsTemplateModalOpen(false)}>
          <div className="email-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px' }}>
            <div className="email-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Mail size={16} color="#0284c7" />
                <h3 className="email-modal-title">
                  {editingTemplate.id ? 'Edit Email Template' : 'Create Email Template'}
                </h3>
              </div>
              <button
                type="button"
                className="email-sync-banner-close"
                onClick={() => setIsTemplateModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate}>
              <div className="email-modal-body">
                <div className="email-field-group">
                  <label className="email-field-label">
                    Template Name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="email-input"
                    placeholder="e.g. Welcome Introduction"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                  />
                </div>

                <div className="email-field-group">
                  <label className="email-field-label">
                    Subject Line <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="email-input"
                    placeholder="e.g. Welcome to {{company}}, {{name}}!"
                    value={editingTemplate.subject}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                  />
                </div>

                <div className="email-field-group">
                  <div className="email-template-editor-topbar">
                    <div className="email-template-mode-tabs">
                      <button
                        type="button"
                        className={`email-template-mode-tab ${templateTab === 'write' ? 'active' : ''}`}
                        onClick={() => setTemplateTab('write')}
                      >
                        <FileText size={13} />
                        <span>Write Message</span>
                      </button>
                      <button
                        type="button"
                        className={`email-template-mode-tab ${templateTab === 'preview' ? 'active' : ''}`}
                        onClick={() => setTemplateTab('preview')}
                      >
                        <Eye size={13} />
                        <span>Live Preview</span>
                      </button>
                    </div>

                    {templateTab === 'write' && (
                      <div className="email-var-chips-row">
                        <span className="email-var-chips-label">Insert variable:</span>
                        {[
                          { tag: '{{name}}', label: 'Name' },
                          { tag: '{{company}}', label: 'Company' },
                          { tag: '{{phone}}', label: 'Phone' },
                          { tag: '{{stage}}', label: 'Stage' }
                        ].map(item => (
                          <button
                            key={item.tag}
                            type="button"
                            className="email-var-chip"
                            onClick={() => insertVariable(item.tag)}
                            title={`Insert ${item.tag} tag`}
                          >
                            + {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {templateTab === 'write' ? (
                    <>
                      <textarea
                        ref={textareaRef}
                        required
                        rows={8}
                        className="email-textarea email-template-natural-textarea"
                        placeholder="Write your email naturally. Use double enters to create new paragraphs..."
                        value={editingTemplate.body_text}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, body_text: e.target.value })}
                      />
                      <span className="email-field-hint">
                        ✨ Write naturally using normal paragraphs and line breaks. Personalization tags like <code>{`{{name}}`}</code> will automatically fill with your lead's details.
                      </span>
                    </>
                  ) : (
                    <div className="email-template-preview-card">
                      <div className="email-preview-meta-row">
                        <span className="email-preview-meta-label">Subject:</span>
                        <span className="email-preview-meta-subject">{getPreviewSubject()}</span>
                      </div>
                      <div className="email-preview-meta-row sub">
                        <span className="email-preview-meta-label">From:</span>
                        <span className="email-preview-meta-value">
                          {config.from_name || 'SimpleCRM'} &lt;{config.from_email || 'notifications@example.com'}&gt;
                        </span>
                      </div>
                      <div className="email-preview-meta-row sub">
                        <span className="email-preview-meta-label">To:</span>
                        <span className="email-preview-meta-value">
                          John Doe &lt;john@acmecorp.com&gt;
                        </span>
                      </div>

                      <div
                        className="email-preview-body-container"
                        dangerouslySetInnerHTML={{
                          __html: getPreviewHtml() || '<p style="color: #94a3b8; font-style: italic; margin: 0;">(Email body is empty)</p>'
                        }}
                      />

                      <div className="email-preview-footer-note">
                        <Sparkles size={13} color="#0284c7" />
                        <span>Highlighted pills show simulated sample data for lead variables.</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="email-modal-footer">
                <button
                  type="button"
                  className="btn-email-secondary"
                  onClick={() => setIsTemplateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-email-primary"
                  disabled={isSavingTemplate}
                >
                  <Check size={14} />
                  <span>{isSavingTemplate ? 'Saving...' : 'Save Template'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
