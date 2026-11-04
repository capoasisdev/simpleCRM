import { useState } from 'react';
import {
  X,
  Headphones,
  Send,
  MessageCircle,
  Mail,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  Lightbulb,
  AlertCircle,
  ArrowUpRight,
  Loader2
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import '../styles/support.css';

const CATEGORIES = [
  { id: 'query', label: 'Query', icon: HelpCircle },
  { id: 'suggestion', label: 'Suggestion', icon: Lightbulb },
  { id: 'support', label: 'Issue / Bug', icon: AlertCircle },
  { id: 'feedback', label: 'Feedback', icon: Sparkles }
];

export default function SupportDrawer({
  isOpen,
  onClose,
  currentUser = {}
}) {
  const [category, setCategory] = useState('query');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const userEmail = currentUser?.email || 'user@simplecrm.com';
  const userName = currentUser?.name || 'CRM Team Member';

  const handleSendQuery = async (e) => {
    e.preventDefault();
    if (!message.trim()) {
      setErrorMsg('Please enter a message or description of your query.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const ticketPayload = {
        user_id: currentUser?.id ? String(currentUser.id) : null,
        user_name: userName,
        user_email: userEmail,
        type: category,
        subject: subject.trim() || `${category.charAt(0).toUpperCase() + category.slice(1)} from ${userName}`,
        message: message.trim(),
        status: 'open',
        metadata: {
          submitted_at: new Date().toISOString(),
          user_role: currentUser?.role || 'user',
          pathname: window.location.pathname
        }
      };

      const { error } = await supabase
        .from('support_tickets')
        .insert([ticketPayload]);

      if (error) {
        throw error;
      }

      setIsSuccess(true);
      setSubject('');
      setMessage('');
    } catch (err) {
      console.error('Error submitting support ticket:', err);
      setErrorMsg(err.message || 'Failed to submit your query. Please try again or reach out via Email/WhatsApp.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setIsSuccess(false);
    setErrorMsg('');
    setSubject('');
    setMessage('');
  };

  // WhatsApp click handler
  const waMessage = encodeURIComponent(
    `Hi Pranav, reaching out from SimpleCRM regarding ${category === 'suggestion' ? 'a feature suggestion' : category === 'support' ? 'a support issue' : 'a query'}.\n\nFrom: ${userName} (${userEmail})`
  );
  const waUrl = `https://api.whatsapp.com/send?text=${waMessage}`;

  // Mailto click handler
  const mailSubject = encodeURIComponent(`SimpleCRM [${category.toUpperCase()}]: ${subject.trim() || 'User Query'}`);
  const mailBody = encodeURIComponent(`Hi Pranav,\n\nI have a ${category} regarding SimpleCRM:\n\nUser: ${userName}\nEmail: ${userEmail}\n\n---\n`);
  const mailtoUrl = `mailto:pranav.p@capoasis.com?subject=${mailSubject}&body=${mailBody}`;

  return (
    <>
      <div className="support-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="support-drawer-panel" role="dialog" aria-label="Support & Help Hub">
        {/* Header */}
        <div className="support-drawer-header">
          <div className="support-header-top-row">
            <div className="support-title-group">
              <div className="support-icon-badge">
                <Headphones size={17} strokeWidth={2} />
              </div>
              <h2>Help & Feedback</h2>
            </div>
            <button
              type="button"
              className="support-close-btn"
              onClick={onClose}
              aria-label="Close support drawer"
            >
              <X size={17} strokeWidth={2} />
            </button>
          </div>
          <p className="support-subtitle">
            Connect directly with Pranav for support, queries, or feature suggestions.
          </p>
        </div>

        {/* Content Body */}
        <div className="support-drawer-body">
          {/* Quick Direct Connect Options */}
          <div>
            <div className="support-section-label">
              <MessageCircle size={13} strokeWidth={2} />
              <span>Direct Channels</span>
            </div>
            <div className="support-channels-grid">
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="support-channel-card whatsapp"
                title="Open WhatsApp chat directly"
              >
                <div className="support-channel-icon-wrap whatsapp">
                  <MessageCircle size={16} strokeWidth={2} />
                </div>
                <div className="support-channel-content">
                  <span className="support-channel-title">
                    WhatsApp
                    <ArrowUpRight size={12} strokeWidth={2} />
                  </span>
                  <span className="support-channel-desc">Instant Chat</span>
                </div>
              </a>

              <a
                href={mailtoUrl}
                className="support-channel-card email"
                title="Send email directly to pranav.p@capoasis.com"
              >
                <div className="support-channel-icon-wrap email">
                  <Mail size={16} strokeWidth={2} />
                </div>
                <div className="support-channel-content">
                  <span className="support-channel-title">
                    Email
                    <ArrowUpRight size={12} strokeWidth={2} />
                  </span>
                  <span className="support-channel-desc">pranav.p@capoasis.com</span>
                </div>
              </a>
            </div>
          </div>

          {/* In-App Form */}
          {isSuccess ? (
            <div className="support-success-container">
              <div className="support-success-icon-wrap">
                <CheckCircle2 size={28} strokeWidth={2.2} />
              </div>
              <h3 className="support-success-title">Query Received!</h3>
              <p className="support-success-desc">
                Thank you, <strong>{userName}</strong>. Your message has been logged directly in the system. Pranav will review it shortly.
              </p>
              <button
                type="button"
                className="support-secondary-btn"
                onClick={handleReset}
              >
                Submit another query
              </button>
            </div>
          ) : (
            <form onSubmit={handleSendQuery} className="support-form-container">
              <div>
                <div className="support-section-label">
                  <Sparkles size={13} strokeWidth={2} />
                  <span>Send In-App Message</span>
                </div>
                <div className="support-type-pills">
                  {CATEGORIES.map((cat) => {
                    const IconComponent = cat.icon;
                    const isActive = category === cat.id;
                    return (
                      <button
                        type="button"
                        key={cat.id}
                        className={`support-type-pill ${isActive ? 'active' : ''}`}
                        onClick={() => setCategory(cat.id)}
                      >
                        <IconComponent size={13} strokeWidth={isActive ? 2 : 1.75} />
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="support-field-group">
                <label className="support-field-label" htmlFor="support-subject">
                  Topic / Subject
                </label>
                <input
                  id="support-subject"
                  type="text"
                  className="support-input"
                  placeholder={
                    category === 'suggestion'
                      ? 'e.g., WhatsApp automated follow-ups'
                      : category === 'support'
                      ? 'e.g., Lead export CSV formatting'
                      : 'e.g., Cold discovery sweep configuration'
                  }
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={120}
                />
              </div>

              <div className="support-field-group">
                <div className="support-field-label">
                  <label htmlFor="support-message">Message / Details</label>
                  <span className="support-char-counter">{message.length}/1000</span>
                </div>
                <textarea
                  id="support-message"
                  className="support-textarea"
                  placeholder={
                    category === 'suggestion'
                      ? 'Describe your idea or what feature you would love to see added...'
                      : category === 'support'
                      ? 'Explain what happened or what assistance you need...'
                      : 'Ask your question or share your feedback...'
                  }
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
                  rows={4}
                  required
                />
              </div>

              {errorMsg && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: -4 }}>
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                className="support-submit-btn"
                disabled={isSubmitting || !message.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={15} className="spinner" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} strokeWidth={2} />
                    <span>Send to Pranav</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </aside>
    </>
  );
}
