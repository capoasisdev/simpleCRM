import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Eye, EyeOff, Lock, CheckCircle2 } from 'lucide-react';
import { setUserPassword, validatePasswordStrength } from '../../lib/auth.js';
import '../../styles/securityModal.css';

export default function SecurityUpgradeModal({ isOpen, user, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen || !user) return null;

  const isMandatory = Boolean(user.must_change_password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!password) {
      setErrorMessage('Please enter a new password.');
      return;
    }

    const validation = validatePasswordStrength(password);
    if (!validation.isValid) {
      setErrorMessage(validation.message);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify and re-enter.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await setUserPassword(user.id, password);
      if (!res.success) {
        setIsSubmitting(false);
        setErrorMessage(res.error || 'Failed to update password. Please try again.');
        return;
      }

      setIsSuccess(true);
      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) onSuccess(res.user);
        if (onClose) onClose();
      }, 1200);
    } catch (err) {
      console.error('Password upgrade error:', err);
      setIsSubmitting(false);
      setErrorMessage('An unexpected error occurred. Please try again.');
    }
  };

  const handleSkip = () => {
    if (isMandatory) return; // Cannot skip mandatory first-login password change
    try {
      sessionStorage.setItem('crm_skipped_pwd_upgrade', 'true');
    } catch {}
    if (onClose) onClose();
  };

  return createPortal(
    <div className="security-upgrade-backdrop" onClick={handleSkip}>
      <div
        className="security-upgrade-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-upgrade-title"
      >
        <div className="security-upgrade-header">
          <div className="security-icon-badge">
            <ShieldCheck size={24} strokeWidth={2} />
          </div>
          <div>
            <h2 id="security-upgrade-title" className="security-upgrade-title">
              {isMandatory ? 'Set Your Permanent Password' : 'Upgrade Account Security'}
            </h2>
            <p className="security-upgrade-subtitle">
              {isMandatory
                ? 'Welcome! You signed in with a temporary initial password. Please choose your permanent password to continue.'
                : 'Your account is currently using a 4-digit PIN. Set a secure password to protect customer leads and CRM access.'}
            </p>
          </div>
        </div>

        {isSuccess ? (
          <div className="security-upgrade-body" style={{ textAlign: 'center', padding: '36px 24px' }}>
            <CheckCircle2 size={42} color="#10b981" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 6px' }}>
              Password Saved Successfully
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              Your account is now secured with your new permanent password.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="security-upgrade-body">
              {errorMessage && (
                <div className="security-error-banner" role="alert">
                  {errorMessage}
                </div>
              )}

              <div className="security-input-group">
                <label className="security-input-label">New Password</label>
                <div className="security-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="security-text-input"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMessage) setErrorMessage('');
                    }}
                    autoFocus
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="security-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="security-input-group">
                <label className="security-input-label">Confirm Password</label>
                <div className="security-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="security-text-input"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (errorMessage) setErrorMessage('');
                    }}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>

            <div className="security-upgrade-footer">
              {!isMandatory && (
                <button
                  type="button"
                  className="security-btn-skip"
                  onClick={handleSkip}
                  disabled={isSubmitting}
                >
                  Remind Me Later
                </button>
              )}
              <button
                type="submit"
                className="security-btn-save"
                disabled={isSubmitting || !password}
              >
                {isSubmitting ? 'Saving...' : (
                  <>
                    <Lock size={14} />
                    <span>Save Password</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

