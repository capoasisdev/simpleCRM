import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createMasterWorkspace } from '../../lib/masterAdmin';

export default function CreateWorkspaceModal({ token, onClose, onCreated }) {
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [trialDays, setTrialDays] = useState('14');
  const [isBillingExempt, setIsBillingExempt] = useState(false);
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [createdResult, setCreatedResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!adminName.trim() || !adminEmail.trim()) {
      setErrorMsg('Admin name and email are required.');
      return;
    }

    setIsSubmitting(true);
    const res = await createMasterWorkspace(token, {
      companyName: companyName.trim() || null,
      adminName: adminName.trim(),
      adminEmail: adminEmail.trim().toLowerCase(),
      adminPhone: adminPhone.trim() || null,
      trialDays: Math.max(1, Number(trialDays || 14)),
      isBillingExempt,
      sendWelcomeEmail,
      loginUrl: typeof window !== 'undefined' ? `${window.location.origin}/login` : null,
    });
    setIsSubmitting(false);

    if (!res?.success) {
      setErrorMsg(res?.error || 'Could not provision workspace.');
      return;
    }

    setCreatedResult(res);
    if (onCreated) onCreated(res.company);
  };

  return (
    <div className="billing-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="billing-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="master-create-ws-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-modal-header">
          <div>
            <h3 id="master-create-ws-title" className="billing-modal-title">
              New Client Workspace
            </h3>
            <p className="billing-modal-subtitle">
              Provision a tenant company, admin account, and default sales pipeline.
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

        <div className="billing-modal-body">
          {createdResult ? (
            <>
              <div className="master-temp-box">
                <strong>Workspace provisioned: {createdResult.company?.name}</strong>
                <span>Admin Email: {createdResult.adminUser?.email}</span>
                {createdResult.tempPassword && (
                  <span>Temporary Password: {createdResult.tempPassword}</span>
                )}
              </div>
              <div className="master-price-row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="billing-header-cta-btn"
                  onClick={onClose}
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="master-section-block" style={{ gap: '16px' }}>
              {errorMsg && (
                <div className="billing-alert-box error" role="alert">
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="master-form-grid">
                <div className="master-field full">
                  <label htmlFor="cw-company-name" className="master-field-label">
                    Workspace / Company Name
                  </label>
                  <input
                    id="cw-company-name"
                    type="text"
                    className="master-inline-input"
                    placeholder="e.g. Acme Realty"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>

                <div className="master-field">
                  <label htmlFor="cw-admin-name" className="master-field-label">
                    Admin Full Name *
                  </label>
                  <input
                    id="cw-admin-name"
                    type="text"
                    className="master-inline-input"
                    placeholder="Full name"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    required
                  />
                </div>

                <div className="master-field">
                  <label htmlFor="cw-admin-email" className="master-field-label">
                    Admin Work Email *
                  </label>
                  <input
                    id="cw-admin-email"
                    type="email"
                    className="master-inline-input"
                    placeholder="founder@company.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="master-field">
                  <label htmlFor="cw-admin-phone" className="master-field-label">
                    Phone Number
                  </label>
                  <input
                    id="cw-admin-phone"
                    type="text"
                    className="master-inline-input"
                    placeholder="Optional"
                    value={adminPhone}
                    onChange={(e) => setAdminPhone(e.target.value)}
                  />
                </div>

                <div className="master-field">
                  <label htmlFor="cw-trial-days" className="master-field-label">
                    Trial Duration (Days)
                  </label>
                  <input
                    id="cw-trial-days"
                    type="number"
                    min="1"
                    max="365"
                    className="master-inline-input"
                    value={trialDays}
                    onChange={(e) => setTrialDays(e.target.value)}
                  />
                </div>
              </div>

              <label className="master-checkbox-row">
                <input
                  type="checkbox"
                  checked={isBillingExempt}
                  onChange={(e) => setIsBillingExempt(e.target.checked)}
                />
                <span>Enterprise Exempt (skip Razorpay paywalls)</span>
              </label>

              <label className="master-checkbox-row">
                <input
                  type="checkbox"
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                />
                <span>Send onboarding email with temporary password</span>
              </label>

              <div className="master-price-row" style={{ justifyContent: 'flex-end', marginTop: '4px' }}>
                <button
                  type="button"
                  className="billing-secondary-btn"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="billing-header-cta-btn"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create Workspace</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

