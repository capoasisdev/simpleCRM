import { useState, useEffect } from 'react';
import { X, Calendar, Clock, AlertCircle, User } from 'lucide-react';
import { createFollowUp } from '../../lib/followups';

export default function ScheduleFollowUpModal({
  isOpen,
  onClose,
  lead,
  availableLeads = [],
  currentUser,
  initialDueDate = '',
  onSuccess
}) {
  const [selectedLeadId, setSelectedLeadId] = useState(lead?.id || '');
  const [customLeadName, setCustomLeadName] = useState(lead?.name || '');
  const [customLeadPhone, setCustomLeadPhone] = useState(lead?.phone || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(initialDueDate || '');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync when lead or initialDueDate prop changes
  useEffect(() => {
    if (lead) {
      setSelectedLeadId(lead.id || '');
      setCustomLeadName(lead.name || '');
      setCustomLeadPhone(lead.phone || '');
    }
  }, [lead]);

  useEffect(() => {
    if (initialDueDate) {
      setDueDate(initialDueDate);
    }
  }, [initialDueDate]);

  if (!isOpen) return null;

  // Quick preset helper
  const setPreset = (hoursFromNow) => {
    const d = new Date();
    d.setHours(d.getHours() + hoursFromNow);
    d.setMinutes(0, 0, 0);
    // Format YYYY-MM-DDTHH:mm
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    setDueDate(`${year}-${month}-${day}T${hours}:${mins}`);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Follow-up Title is required.');
      return;
    }
    if (!dueDate) {
      setError('Please select a Due Date & Time.');
      return;
    }

    // Determine target lead
    let targetLead = lead;
    if (!targetLead && selectedLeadId && availableLeads.length > 0) {
      targetLead = availableLeads.find((l) => l.id === selectedLeadId);
    }

    const finalLeadName = targetLead?.name || customLeadName.trim() || 'General Follow-up';
    const finalLeadPhone = targetLead?.phone || customLeadPhone.trim() || '';
    const finalLeadEmail = targetLead?.email || '';

    setIsSubmitting(true);
    try {
      const created = await createFollowUp({
        leadId: targetLead?.id || null,
        leadName: finalLeadName,
        leadPhone: finalLeadPhone,
        leadEmail: finalLeadEmail,
        title: title.trim(),
        description: description.trim(),
        dueDate,
        userName: currentUser?.name || 'Sales Rep'
      });
      if (onSuccess) onSuccess(created);
      onClose();
    } catch (err) {
      console.error('Failed to create follow-up:', err);
      setError('Failed to schedule follow-up. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="lead-modal-backdrop" style={{ zIndex: 400 }} onClick={onClose}>
      <div
        className="schedule-followup-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="schedule-followup-header">
          <div>
            <h3 className="schedule-followup-title">Schedule Follow-up</h3>
            {lead ? (
              <p className="schedule-followup-lead-badge">
                For: <strong>{lead.name}</strong> {lead.phone ? `(${lead.phone})` : ''}
              </p>
            ) : (
              <p className="schedule-followup-lead-badge">
                Add an upcoming follow-up reminder
              </p>
            )}
          </div>
          <button
            type="button"
            className="lead-properties-seamless-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="schedule-followup-form">
          {error && (
            <div className="schedule-followup-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Lead Picker (if no specific lead was provided) */}
          {!lead && (
            <div className="schedule-followup-field">
              <label className="schedule-followup-label">
                Associated Lead {availableLeads.length > 0 ? '' : '(Optional)'}
              </label>
              {availableLeads.length > 0 ? (
                <select
                  className="schedule-followup-input"
                  value={selectedLeadId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedLeadId(id);
                    const found = availableLeads.find((l) => l.id === id);
                    if (found) {
                      setCustomLeadName(found.name);
                      setCustomLeadPhone(found.phone || '');
                    }
                  }}
                >
                  <option value="">-- Select a Lead (or leave empty) --</option>
                  {availableLeads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} {l.phone ? `(${l.phone})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="schedule-followup-input"
                  placeholder="Enter lead or contact name"
                  value={customLeadName}
                  onChange={(e) => setCustomLeadName(e.target.value)}
                />
              )}
            </div>
          )}

          {/* Title */}
          <div className="schedule-followup-field">
            <label className="schedule-followup-label">
              Follow-up Title <span className="required-star">*</span>
            </label>
            <input
              type="text"
              className="schedule-followup-input"
              placeholder="Follow-up title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError('');
              }}
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="schedule-followup-field">
            <label className="schedule-followup-label">Description</label>
            <textarea
              className="schedule-followup-textarea"
              placeholder="Follow-up Description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Due Date & Time */}
          <div className="schedule-followup-field">
            <div className="schedule-followup-due-header">
              <label className="schedule-followup-label">
                Due Date <span className="required-star">*</span>
              </label>
              <div className="schedule-followup-presets">
                <button
                  type="button"
                  className="preset-pill-btn"
                  onClick={() => setPreset(4)}
                  title="Today in 4 hours"
                >
                  Today 4h
                </button>
                <button
                  type="button"
                  className="preset-pill-btn"
                  onClick={() => setPreset(24)}
                  title="Tomorrow same time"
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  className="preset-pill-btn"
                  onClick={() => setPreset(48)}
                  title="In 2 days"
                >
                  In 2 days
                </button>
              </div>
            </div>
            <div className="schedule-followup-date-wrap">
              <input
                type="datetime-local"
                className="schedule-followup-input date-input"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  if (error) setError('');
                }}
              />
            </div>
          </div>

          {/* Footer with ADD button */}
          <div className="schedule-followup-footer">
            <button
              type="button"
              className="schedule-followup-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="schedule-followup-submit-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Scheduling...' : 'ADD'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
