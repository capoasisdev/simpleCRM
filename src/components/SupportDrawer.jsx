import { useState, useEffect, useRef } from 'react';
import { X, Send, CheckCircle2, Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import '../styles/support.css';

export default function SupportDrawer({
  isOpen,
  onClose,
  currentUser = {}
}) {
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setIsSuccess(false);
      setErrorMsg('');
      setMessage('');
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 60);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const userEmail = currentUser?.email || 'user@simplecrm.com';
  const userName = currentUser?.name || 'CRM Team Member';

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const cleanMsg = message.trim();
    if (!cleanMsg) {
      setErrorMsg('Please write your note before sending.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const ticketPayload = {
        user_id: currentUser?.id ? String(currentUser.id) : null,
        user_name: userName,
        user_email: userEmail,
        type: 'feedback',
        subject: `Note from ${userName}`,
        message: cleanMsg,
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

      if (error) throw error;

      setIsSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err) {
      console.error('Error submitting feedback note:', err);
      setErrorMsg(err.message || 'Failed to send note. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="support-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="support-modal-dialog" role="dialog" aria-label="Feedback & Support">
        <div className="support-modal-header">
          <div className="support-modal-title-group">
            <div className="support-modal-icon-badge">
              <MessageSquare size={16} strokeWidth={2} />
            </div>
            <div>
              <h2 className="support-modal-title">Feedback & Support</h2>
              <p className="support-modal-subtitle">Send a direct note, suggestion, or bug report to Pranav.</p>
            </div>
          </div>
          <button
            type="button"
            className="support-modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={17} strokeWidth={2} />
          </button>
        </div>

        {isSuccess ? (
          <div className="support-modal-success">
            <CheckCircle2 size={32} strokeWidth={2.2} className="support-success-icon" />
            <h3 className="support-success-heading">Note Sent</h3>
            <p className="support-success-subheading">Thank you! Your note has been delivered directly to Pranav.</p>
          </div>
        ) : (
          <form onSubmit={handleSend} className="support-modal-form">
            <div className="support-modal-body">
              <textarea
                ref={textareaRef}
                className="support-modal-textarea"
                placeholder="What's on your mind? Found a bug or have an idea? Type here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={2000}
                disabled={isSubmitting}
              />
              {errorMsg && <div className="support-modal-error">{errorMsg}</div>}
            </div>

            <div className="support-modal-footer">
              <button
                type="button"
                className="support-btn-cancel"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="support-btn-send"
                disabled={isSubmitting || !message.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="support-spinner" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send size={13} strokeWidth={2} />
                    <span>Send Note</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
