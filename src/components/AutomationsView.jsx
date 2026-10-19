import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  UserPlus,
  RefreshCw,
  MessageCircle,
  Mail,
  Send,
  Check,
  CheckCheck,
  CheckCircle2,
  AlertCircle,
  Phone,
  Video,
  MoreVertical,
  Paperclip,
  Mic,
  Smile,
  ChevronDown,
  ChevronRight,
  User,
  Users,
  Play,
  Zap
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sendWhatsAppMessage } from '../lib/whatsapp';
import Skeleton from './common/Skeleton';
import '../styles/automations.css';

export default function AutomationsView({ currentUser }) {
  const [currentView, setCurrentView] = useState('hub'); // 'hub' | 'whatsapp'
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // --------------------------------------------------------------------------
  // WhatsApp Welcome Automation States
  // --------------------------------------------------------------------------
  const [waStep, setWaStep] = useState(3);
  const [waName, setWaName] = useState('Meta WhatsApp Welcome Flow');
  const [waTrigger, setWaTrigger] = useState('new_lead');
  const [waAction, setWaAction] = useState('whatsapp');
  const [waConfigId, setWaConfigId] = useState(null);
  const [phoneId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [templateName, setTemplateName] = useState('salado_lead_welcome');
  const [isWaActive, setIsWaActive] = useState(false);
  const [isSavingWa, setIsSavingWa] = useState(false);
  const [showCredentialsDrawer, setShowCredentialsDrawer] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testLeadName, setTestLeadName] = useState('Pranav');
  const [isTestingWa, setIsTestingWa] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Email fallback action states
  const [emailSubject, setEmailSubject] = useState('Welcome to our platform!');
  const [emailBody, setEmailBody] = useState('Hi {{name}}, thanks for reaching out! We received your request.');

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --------------------------------------------------------------------------
  // Data Fetching: Supabase Meta WhatsApp Config
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;
    const fetchAllData = async () => {
      try {
        const { data: metaData } = await supabase
          .from('meta_config')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (isMounted && metaData) {
          setWaConfigId(metaData.id);
          setPhoneId(metaData.whatsapp_phone_number_id || '');
          setWabaId(metaData.whatsapp_business_account_id || '');
          setAccessToken(metaData.whatsapp_access_token || '');
          setTemplateName(metaData.whatsapp_template || 'salado_lead_welcome');
          setIsWaActive(Boolean(metaData.whatsapp_auto_welcome));
        }
      } catch (err) {
        console.warn('Error loading automation data:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchAllData();
    return () => {
      isMounted = false;
    };
  }, []);

  // --------------------------------------------------------------------------
  // WhatsApp Actions
  // --------------------------------------------------------------------------
  const handleToggleActivateWa = async () => {
    setIsSavingWa(true);
    const nextState = !isWaActive;
    setIsWaActive(nextState);

    try {
      const payload = {
        whatsapp_phone_number_id: phoneId.trim(),
        whatsapp_business_account_id: wabaId.trim(),
        whatsapp_access_token: accessToken.trim(),
        whatsapp_template: templateName.trim() || 'salado_lead_welcome',
        whatsapp_auto_welcome: nextState,
        updated_at: new Date().toISOString()
      };

      if (waConfigId) {
        const { error } = await supabase
          .from('meta_config')
          .update(payload)
          .eq('id', waConfigId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('meta_config')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        if (data) setWaConfigId(data.id);
      }

      showToast(nextState ? 'WhatsApp Welcome Activated' : 'WhatsApp Welcome Paused');
    } catch (err) {
      console.error('Error activating WhatsApp automation:', err);
      showToast('Could not save state: ' + err.message, 'error');
      setIsWaActive(!nextState);
    } finally {
      setIsSavingWa(false);
    }
  };

  const handleSaveWaCredentials = async () => {
    setIsSavingWa(true);
    try {
      const payload = {
        whatsapp_phone_number_id: phoneId.trim(),
        whatsapp_business_account_id: wabaId.trim(),
        whatsapp_access_token: accessToken.trim(),
        whatsapp_template: templateName.trim() || 'salado_lead_welcome',
        whatsapp_auto_welcome: isWaActive,
        updated_at: new Date().toISOString()
      };

      if (waConfigId) {
        await supabase.from('meta_config').update(payload).eq('id', waConfigId);
      } else {
        const { data } = await supabase.from('meta_config').insert(payload).select().single();
        if (data) setWaConfigId(data.id);
      }

      showToast('WhatsApp API credentials saved', 'success');
      setShowCredentialsDrawer(false);
    } catch (err) {
      showToast('Failed to save: ' + err.message, 'error');
    } finally {
      setIsSavingWa(false);
    }
  };

  const handleSendTestWa = async () => {
    if (!testPhone.trim()) {
      setTestResult({
        success: false,
        message: 'Please enter a recipient phone number (e.g. +91 98765 43210)'
      });
      return;
    }

    setIsTestingWa(true);
    setTestResult(null);

    try {
      const res = await sendWhatsAppMessage({
        to: testPhone.trim(),
        leadName: testLeadName.trim() || 'Pranav',
        templateName: templateName.trim() || 'salado_lead_welcome',
        overrideConfig: {
          whatsapp_phone_number_id: phoneId.trim(),
          whatsapp_access_token: accessToken.trim(),
          whatsapp_template: templateName.trim() || 'salado_lead_welcome'
        }
      });

      setTestResult({
        success: true,
        message: `Template "${res.template}" delivered successfully.`
      });
      showToast('Test WhatsApp message delivered', 'success');
    } catch (err) {
      setTestResult({
        success: false,
        message: err.message || 'Delivery failed. Check Meta credentials.'
      });
    } finally {
      setIsTestingWa(false);
    }
  };



  if (isLoading) {
    return (
      <div className="automations-builder-root">
        <div className="automations-hub-container">
          <div className="hub-master-header">
            <h1 className="hub-master-title">Automations</h1>
          </div>

          <div className="hub-cards-grid">
            {[1, 2].map((i) => (
              <div key={i} className="automations-skeleton-card">
                <div className="automations-skeleton-card-top">
                  <div className="automations-skeleton-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Skeleton width="34px" height="34px" borderRadius="8px" />
                      <Skeleton width={i === 1 ? '160px' : '140px'} height="17px" borderRadius="4px" />
                    </div>
                    <Skeleton width="54px" height="20px" borderRadius="999px" />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <Skeleton width="100%" height="13px" borderRadius="3px" />
                    <Skeleton width="82%" height="13px" borderRadius="3px" />
                  </div>

                  <div className="automations-skeleton-flow">
                    <Skeleton width="90px" height="13px" borderRadius="3px" />
                    <span style={{ color: '#cbd5e1', fontSize: '11px' }}>──▶</span>
                    <Skeleton width="130px" height="13px" borderRadius="3px" />
                  </div>
                </div>

                <div className="automations-skeleton-card-footer">
                  <Skeleton width="125px" height="14px" borderRadius="3px" />
                  <Skeleton width="14px" height="14px" borderRadius="3px" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // VIEW 1: AUTOMATIONS HUB (ENTRY SCREEN)
  // ==========================================================================
  if (currentView === 'hub') {
    return (
      <div className="automations-builder-root">
        {toast && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              right: 28,
              zIndex: 9999,
              backgroundColor: '#111827',
              color: '#ffffff',
              padding: '8px 16px',
              borderRadius: '4px',
              fontSize: '12.5px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Check size={14} style={{ color: '#10b981' }} />
            <span>{toast.message}</span>
          </div>
        )}

        <div className="automations-hub-container">
          <div className="hub-master-header">
            <h1 className="hub-master-title">Automations</h1>
          </div>

          <div className="hub-cards-grid">
            {/* WORKFLOW 1: WhatsApp Automation */}
            <div className="hub-workflow-card" onClick={() => setCurrentView('whatsapp')}>
              <div className="hub-card-top">
                <div className="hub-card-header-row">
                  <div className="hub-card-title-group">
                    <div className="hub-card-icon">
                      <MessageCircle size={18} />
                    </div>
                    <h3 className="hub-card-title">Whatsapp Automation</h3>
                  </div>
                  <span className={`hub-status-badge ${isWaActive ? 'active' : 'paused'}`}>
                    <span>{isWaActive ? 'Active' : 'Paused'}</span>
                  </span>
                </div>

                <div className="hub-card-info">
                  <p>
                    Automatically send Meta-approved WhatsApp template messages to new leads instantly upon creation.
                  </p>
                </div>

                <div className="hub-flow-snippet">
                  <Zap size={13} />
                  <span>New Lead Added</span>
                  <span style={{ color: '#9ca3af' }}>──▶</span>
                  <MessageCircle size={13} />
                  <span>Send WhatsApp Welcome</span>
                </div>
              </div>

              <div className="hub-btn-configure">
                <span>Configure Workflow</span>
                <ArrowRight size={14} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // VIEW 2: WHATSAPP WELCOME FLOW BUILDER
  // ==========================================================================
  if (currentView === 'whatsapp') {
    return (
      <div className="automations-builder-root">
        {toast && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              right: 28,
              zIndex: 9999,
              backgroundColor: '#111827',
              color: '#ffffff',
              padding: '8px 16px',
              borderRadius: '4px',
              fontSize: '12.5px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <Check size={14} style={{ color: '#10b981' }} />
            <span>{toast.message}</span>
          </div>
        )}

        {/* Top Bar */}
        <div className="builder-top-bar">
          <button
            type="button"
            className="btn-back-automations"
            onClick={() => setCurrentView('hub')}
          >
            <ArrowLeft size={13} />
            <span>Back to Automations</span>
          </button>

          <div className="builder-stepper">
            <div className={`stepper-step ${waStep >= 1 ? 'completed active' : ''}`}>
              <span className="step-box">1</span>
              <span>Name</span>
            </div>
            <div className="stepper-line"></div>

            <div className={`stepper-step ${waStep >= 2 ? 'completed active' : ''}`}>
              <span className="step-box">2</span>
              <span>Trigger</span>
            </div>
            <div className="stepper-line"></div>

            <div className={`stepper-step ${waStep >= 3 ? 'active' : ''}`}>
              <span className="step-box">3</span>
              <span>Action</span>
            </div>
            <div className="stepper-line"></div>

            <div className={`stepper-step ${waStep >= 4 ? 'active' : ''}`}>
              <span className="step-box">4</span>
              <span>Activate</span>
            </div>
          </div>

          <div style={{ width: 140 }}></div>
        </div>

        {/* 2-Column Canvas Layout */}
        <div className="builder-workspace">
          {/* Left Canvas Column */}
          <div className="builder-canvas-col">
            {/* Step 1: Name */}
            <div className="flow-solid-card">
              <h2 className="flow-node-title">Name your automation</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label className="flow-field-label">Automation Name</label>
                <input
                  type="text"
                  className="flow-text-input"
                  value={waName}
                  onChange={(e) => setWaName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-flow-continue"
                  onClick={() => setWaStep(2)}
                >
                  <span>Continue</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 2: Trigger */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">When this happens...</h3>
              <div className="flow-options-grid">
                <div
                  className={`flow-option-card ${waTrigger === 'new_lead' ? 'selected' : ''}`}
                  onClick={() => {
                    setWaTrigger('new_lead');
                    setWaStep(3);
                  }}
                >
                  <div className="flow-option-icon">
                    <UserPlus size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">New Lead Added</h4>
                    <p className="flow-option-sub">Triggered when a lead is imported or added.</p>
                  </div>
                </div>

                <div
                  className={`flow-option-card ${waTrigger === 'status_changed' ? 'selected' : ''}`}
                  onClick={() => {
                    setWaTrigger('status_changed');
                    setWaStep(3);
                  }}
                >
                  <div className="flow-option-icon">
                    <RefreshCw size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">Status Changed</h4>
                    <p className="flow-option-sub">Triggered on pipeline stage moves.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 3: Action */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">Do this...</h3>
              <div className="flow-options-grid">
                <div
                  className={`flow-option-card ${waAction === 'whatsapp' ? 'selected' : ''}`}
                  onClick={() => setWaAction('whatsapp')}
                >
                  <div className="flow-option-icon">
                    <MessageCircle size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">Send WhatsApp</h4>
                    <p className="flow-option-sub">Send a pre-defined message template.</p>
                  </div>
                </div>

                <div
                  className={`flow-option-card ${waAction === 'email' ? 'selected' : ''}`}
                  onClick={() => setWaAction('email')}
                >
                  <div className="flow-option-icon">
                    <Mail size={16} />
                  </div>
                  <div className="flow-option-texts">
                    <h4 className="flow-option-title">Send Email</h4>
                    <p className="flow-option-sub">Send a standard email sequence.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 4: Action Settings */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">Action Settings</h3>

              {waAction === 'whatsapp' ? (
                <div className="action-settings-card">
                  <div className="template-badge-row">
                    <div>
                      <label className="flow-field-label">WhatsApp Approved Template</label>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#111827', marginTop: 3 }}>
                        {templateName || 'salado_lead_welcome'}
                      </div>
                    </div>
                    <span className="template-status-badge">
                      <span className="template-status-dot"></span>
                      <span>Approved</span>
                    </span>
                  </div>
                </div>
              ) : (
                /* EMAIL SETTINGS */
                <div className="action-settings-card">
                  <div>
                    <label className="flow-field-label" style={{ marginBottom: 6, display: 'block' }}>
                      Subject Line
                    </label>
                    <input
                      type="text"
                      className="flow-text-input"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="flow-field-label" style={{ marginBottom: 6, display: 'block' }}>
                      Email Body
                    </label>
                    <textarea
                      className="flow-text-input"
                      style={{ height: 90, padding: '10px 12px', resize: 'vertical' }}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                    />
                  </div>

                  <div className="available-tags-row">
                    <span>Available Tags:</span>
                    <span className="tag-chip">{'{{name}}'}</span>
                    <span className="tag-chip">{'{{source}}'}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flow-down-arrow">↓</div>

            {/* Step 5: Finalize */}
            <div className="flow-dashed-container">
              <h3 className="flow-node-title">Finalize</h3>
              <div className="finalize-card">
                <button
                  type="button"
                  className={`btn-activate-large ${isWaActive ? 'active-state' : 'primary-activate'}`}
                  onClick={handleToggleActivateWa}
                  disabled={isSavingWa}
                >
                  {isSavingWa ? (
                    <>
                      <RefreshCw size={14} className="spin-icon" />
                      <span>Saving...</span>
                    </>
                  ) : isWaActive ? (
                    <>
                      <Check size={15} />
                      <span>Automation is Active (Click to Pause)</span>
                    </>
                  ) : (
                    <span>Activate Automation</span>
                  )}
                </button>
                <p className="finalize-caption">
                  {isWaActive
                    ? 'Live: Automatically sending WhatsApp messages for incoming leads.'
                    : 'Ready to launch. Click Activate to begin automatic dispatch.'}
                </p>
              </div>
            </div>
          </div>

          {/* Right Live Preview Column (iPhone) */}
          <div className="builder-preview-col">
            <div className="iphone-mockup">
              <div className="iphone-screen">
                <div className="iphone-status-bar">
                  <span>9:41</span>
                  <div className="iphone-status-icons">
                    <span>●●●</span>
                    <span>📶</span>
                    <span>🔋</span>
                  </div>
                </div>

                {waAction === 'whatsapp' ? (
                  <>
                    <div className="wa-app-header">
                      <div className="wa-header-left">
                        <span style={{ fontSize: 13, color: '#374151' }}>‹</span>
                        <div className="wa-avatar">S</div>
                        <div className="wa-contact-info">
                          <span className="wa-contact-name">SimpleCRM</span>
                          <span className="wa-contact-status">online</span>
                        </div>
                      </div>
                      <div className="wa-header-actions">
                        <Video size={13} />
                        <Phone size={13} />
                        <MoreVertical size={13} />
                      </div>
                    </div>

                    <div className="wa-chat-canvas">
                      <div className="wa-chat-bubble-received">
                        <p className="wa-bubble-text">
                          Hello {testLeadName || 'there'}, thank you for your interest in SaladO!
                          {'\n\n'}
                          We have received your franchise inquiry. Our team will connect with you shortly to share the brand presentation and guide you through the next steps.
                        </p>
                        <div className="wa-bubble-meta">
                          <span>9:41 AM</span>
                          <span className="wa-ticks">
                            <CheckCheck size={13} color="#53bdeb" />
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="wa-bottom-bar">
                      <Smile size={15} color="#6b7280" />
                      <div className="wa-input-pill">Message</div>
                      <Paperclip size={15} color="#6b7280" />
                      <div className="wa-mic-btn">
                        <Mic size={13} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="email-app-screen">
                    <div className="email-app-header">
                      <span>‹ Inbox</span>
                      <span>🗑</span>
                    </div>

                    <div className="email-app-body">
                      <h4 className="email-subject">{emailSubject || '(No Subject)'}</h4>
                      <div className="email-sender-row">
                        <div className="email-avatar">S</div>
                        <div className="email-sender-info">
                          <span className="email-sender-name">SimpleCRM</span>
                          <span className="email-sender-to">To: {testLeadName || 'Lead Name'}</span>
                        </div>
                      </div>
                      <p className="email-content-text">
                        {emailBody.replace('{{name}}', testLeadName || 'there')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

