import { useState } from 'react';
import { Download, Expand, Loader2, X } from 'lucide-react';
import { updateMasterSupportTicket } from '../../lib/masterAdmin';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TicketDetailModal({ token, ticket, onClose, onUpdated }) {
  const [status, setStatus] = useState(ticket?.status || 'open');
  const [resolutionNote, setResolutionNote] = useState(
    ticket?.metadata?.resolution_note || ''
  );
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!ticket) return null;

  const attachments = Array.isArray(ticket?.metadata?.attachments)
    ? ticket.metadata.attachments.filter((a) => a && a.data)
    : [];

  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setIsSaving(true);
    const res = await updateMasterSupportTicket(token, ticket.id, status, resolutionNote);
    setIsSaving(false);

    if (!res?.success) {
      setErrorMsg(res?.error || 'Could not update ticket.');
      return;
    }

    if (onUpdated) onUpdated(res.ticket);
    onClose();
  };

  return (
    <>
      <div className="billing-modal-backdrop" role="presentation" onClick={onClose}>
        <div
          className="billing-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="master-ticket-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="billing-modal-header">
            <div>
              <h3 id="master-ticket-modal-title" className="billing-modal-title">
                {ticket.subject || 'Support Request'}
              </h3>
              <p className="billing-modal-subtitle">
                {ticket.company_name} · {ticket.user_name || ticket.user_email} ({formatDateTime(ticket.created_at)})
              </p>
            </div>
            <button
              type="button"
              className="billing-modal-close-btn"
              onClick={onClose}
              aria-label="Close modal"
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSave} className="billing-modal-body">
            {errorMsg && (
              <div className="billing-alert-box error" role="alert">
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="master-section-block">
              <span className="master-section-label">
                {ticket.type || 'query'} · {ticket.user_email || 'No email'}
              </span>
              <div className="master-ticket-message">{ticket.message}</div>
            </div>

            {attachments.length > 0 && (
              <div className="master-section-block">
                <span className="master-section-label">
                  Attachments ({attachments.length})
                </span>
                <div className="master-attachments-grid">
                  {attachments.map((att, idx) => (
                    <div key={`${att.name || 'file'}-${idx}`} className="master-attachment-card">
                      <button
                        type="button"
                        className="master-attachment-thumb-btn"
                        onClick={() => setPreviewAttachment(att)}
                        title="View full image"
                      >
                        <img
                          src={att.data}
                          alt={att.name || `Attachment ${idx + 1}`}
                          className="master-attachment-thumb"
                        />
                      </button>
                      <div className="master-attachment-footer">
                        <span
                          className="master-attachment-name"
                          title={att.name || `Attachment ${idx + 1}`}
                        >
                          {att.name || `Screenshot ${idx + 1}`}
                          {att.size ? ` · ${formatBytes(att.size)}` : ''}
                        </span>
                        <div className="master-attachment-actions">
                          <button
                            type="button"
                            className="master-attachment-icon-btn"
                            onClick={() => setPreviewAttachment(att)}
                            aria-label="Preview attachment"
                            title="Preview"
                          >
                            <Expand size={13} />
                          </button>
                          <a
                            href={att.data}
                            download={att.name || `attachment-${idx + 1}.png`}
                            className="master-attachment-icon-btn"
                            aria-label="Download attachment"
                            title="Download"
                          >
                            <Download size={13} />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="master-form-grid">
              <div className="master-field">
                <label htmlFor="ticket-status-select" className="master-field-label">
                  Ticket Status
                </label>
                <select
                  id="ticket-status-select"
                  className="master-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            <div className="master-field">
              <label htmlFor="ticket-resolution-note" className="master-field-label">
                Internal Resolution Note
              </label>
              <textarea
                id="ticket-resolution-note"
                className="master-textarea"
                placeholder="Optional note for your team..."
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
              />
            </div>

            <div className="master-price-row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="billing-secondary-btn"
                onClick={onClose}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="billing-header-cta-btn"
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Update Ticket</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {previewAttachment && (
        <div
          className="master-lightbox-backdrop"
          role="presentation"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="master-lightbox-frame"
            role="dialog"
            aria-modal="true"
            aria-label="Attachment Preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="master-lightbox-bar">
              <span>{previewAttachment.name || 'Screenshot'}</span>
              <div className="master-attachment-actions">
                <a
                  href={previewAttachment.data}
                  download={previewAttachment.name || 'attachment.png'}
                  className="master-attachment-icon-btn"
                  aria-label="Download image"
                  title="Download"
                >
                  <Download size={14} />
                </a>
                <button
                  type="button"
                  className="master-attachment-icon-btn"
                  onClick={() => setPreviewAttachment(null)}
                  aria-label="Close preview"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <img
              src={previewAttachment.data}
              alt={previewAttachment.name || 'Attachment full preview'}
              className="master-lightbox-img"
            />
          </div>
        </div>
      )}
    </>
  );
}
