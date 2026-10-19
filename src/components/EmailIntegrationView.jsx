import { useState, useEffect, useRef } from 'react';
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
import '../styles/email.css';

export default function EmailIntegrationView({ currentUser }) {
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
      <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton width="100%" height="88px" borderRadius="12px" />
        <Skeleton width="100%" height="240px" borderRadius="12px" />
        <Skeleton width="100%" height="200px" borderRadius="12px" />
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
      <div className={`email-hero-card ${config.is_connected ? 'is-connected' : ''}`}>
        <div className="email-hero-left">
          <div className="email-brand-tile">
            <Mail size={24} />
          </div>
          <div className="email-hero-info">
            <div className="email-hero-title-row">
              <span className="email-hero-title">Resend Email Engine</span>
              <div className={`email-status-chip ${config.is_connected ? 'connected' : 'disconnected'}`}>
                <span className="email-status-dot" />
                <span>{config.is_connected ? 'Connected' : 'Disconnected'}</span>
              </div>
              {config.is_connected && config.from_email && (
                <span className="email-sender-pill">Sender: {config.from_email}</span>
              )}
            </div>
          </div>
        </div>

        <div className="email-hero-actions">
          <button
            type="button"
            className="btn-email-secondary"
            onClick={() => {
              setTestFeedback(null);
              setIsTestModalOpen(true);
            }}
            disabled={!config.api_key}
            title="Send a live test email"
          >
            <Send size={13} />
            <span>Test Email</span>
          </button>

          {config.is_connected && (
            <button
              type="button"
              className="btn-email-danger"
              onClick={handleDisconnect}
              title="Disconnect Resend service"
            >
              <Unlink size={13} />
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* SECTION 2: CREDENTIALS & SENDER CONFIGURATION */}
      <div className="email-panel-card">
        <div className="email-panel-header">
          <div className="email-panel-header-left">
            <span className="email-panel-title">API Credentials & Sender Profile</span>
          </div>
          <a
            href="https://resend.com/api-keys"
            target="_blank"
            rel="noreferrer"
            className="email-docs-link"
          >
            <span>Get Resend API Key</span>
            <ExternalLink size={12} />
          </a>
        </div>

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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #f1f5f9', animation: 'emailFadeIn 0.2s ease' }}>
            <button
              type="button"
              className="btn-email-primary"
              onClick={() => handleSaveSettings()}
              disabled={isSaving}
            >
              <Check size={14} strokeWidth={2.5} />
              <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        )}
      </div>

      {/* SECTION 3: EMAIL TEMPLATES */}
      <div className="email-panel-card">
        <div className="email-panel-header">
          <div className="email-panel-header-left">
            <span className="email-panel-title">Automated Email Templates</span>
            <span className="email-badge-count">{templates.length}</span>
          </div>
          <button
            type="button"
            className="btn-email-primary"
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
            <Plus size={14} strokeWidth={2.5} />
            <span>Create Template</span>
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="email-empty-state">
            <Mail size={32} strokeWidth={1.2} />
            <p>No email templates created yet. Create one to attach to pipeline stages.</p>
          </div>
        ) : (
          <div className="email-template-list">
            {templates.map(tmpl => {
              const strippedBody = htmlToPlainText(tmpl.body_html || '').replace(/\s+/g, ' ').trim();
              return (
                <div key={tmpl.id} className="email-template-item">
                  <div className="email-template-identity">
                    <div className="email-template-icon-tile">
                      <Mail size={16} />
                    </div>
                    <div className="email-template-info">
                      <div className="email-template-header-row">
                        <span className="email-template-name">{tmpl.name}</span>
                        {tmpl.subject && (
                          <span className="email-template-subject-pill" title={tmpl.subject}>
                            Subject: {tmpl.subject}
                          </span>
                        )}
                      </div>
                      {strippedBody && (
                        <div className="email-template-snippet" title={strippedBody}>
                          {strippedBody}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="email-template-actions">
                    <button
                      type="button"
                      className="btn-email-row-action"
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
                      title="Edit template"
                      aria-label={`Edit ${tmpl.name}`}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-email-row-action danger"
                      onClick={() => handleDeleteTemplate(tmpl.id, tmpl.name)}
                      title="Delete template"
                      aria-label={`Delete ${tmpl.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL 1: TEST EMAIL MODAL */}
      {isTestModalOpen && (
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
        </div>
      )}

      {/* MODAL 2: CREATE / EDIT TEMPLATE MODAL */}
      {isTemplateModalOpen && (
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
        </div>
      )}
    </div>
  );
}
