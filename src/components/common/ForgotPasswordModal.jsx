import { useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Mail, ArrowLeft, CheckCircle2, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { requestPasswordResetCode, resetPasswordWithCode, validatePasswordStrength } from '../../lib/auth.js';
import '../../styles/securityModal.css';

export default function ForgotPasswordModal({ isOpen, initialEmail = '', onClose, onSuccess }) {
  const [step, setStep] = useState(1); // 1 = enter email, 2 = enter OTP + new password, 3 = success
  const [email, setEmail] = useState(initialEmail || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [adminContact, setAdminContact] = useState(null);

  if (!isOpen) return null;

  // Step 1: Request 6-digit OTP code
  const handleRequestCode = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setAdminContact(null);

    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed) {
      setErrorMessage('Please enter your work account email.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await requestPasswordResetCode(trimmed);

      if (!res.success) {
        setIsLoading(false);
        if (res.error === 'EMAIL_SERVICE_NOT_CONNECTED') {
          setAdminContact(res.adminContact || { name: 'CRM Administrator' });
        } else {
          setErrorMessage(res.error || 'Failed to request reset code. Please try again.');
        }
        return;
      }

      setIsLoading(false);
      setStep(2);
    } catch (err) {
      console.error('Error requesting reset code:', err);
      setIsLoading(false);
      setErrorMessage('An unexpected error occurred. Please try again.');
    }
  };

  // Step 2: Validate OTP and update password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedCode = (code || '').trim().replace(/\D/g, '');
    if (trimmedCode.length !== 6) {
      setErrorMessage('Please enter the full 6-digit verification code.');
      return;
    }

    const val = validatePasswordStrength(newPassword);
    if (!val.isValid) {
      setErrorMessage(val.message);
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify and re-enter.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await resetPasswordWithCode(email, trimmedCode, newPassword);

      if (!res.success) {
        setIsLoading(false);
        setErrorMessage(res.error || 'Failed to reset password. Please check your code.');
        return;
      }

      setIsLoading(false);
      setStep(3);

      setTimeout(() => {
        if (onSuccess) onSuccess();
        if (onClose) onClose();
      }, 1500);
    } catch (err) {
      console.error('Error resetting password:', err);
      setIsLoading(false);
      setErrorMessage('Failed to reset password. Please try again.');
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setStep(1);
    setErrorMessage('');
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setAdminContact(null);
    if (onClose) onClose();
  };

  return createPortal(
    <div className="security-upgrade-backdrop" onClick={handleClose}>
      <div
        className="security-upgrade-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-password-title"
      >
        <div className="security-upgrade-header">
          <div className="security-icon-badge">
            <KeyRound size={22} strokeWidth={2} />
          </div>
          <div>
            <h2 id="forgot-password-title" className="security-upgrade-title">
              {step === 3 ? 'Password Reset Complete' : 'Reset Your Password'}
            </h2>
            <p className="security-upgrade-subtitle">
              {step === 1 && 'Enter your work account email to receive a 6-digit recovery code.'}
              {step === 2 && `Enter the 6-digit code sent to ${email} and choose your new password.`}
              {step === 3 && 'Your password has been updated. You can now sign in.'}
            </p>
          </div>
        </div>

        {step === 3 ? (
          <div className="security-upgrade-body" style={{ textAlign: 'center', padding: '36px 24px' }}>
            <CheckCircle2 size={44} color="#10b981" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 6px' }}>
              Password Reset Successfully
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              Returning to sign in with your new password...
            </p>
          </div>
        ) : step === 1 ? (
          <form onSubmit={handleRequestCode}>
            <div className="security-upgrade-body">
              {errorMessage && (
                <div className="security-error-banner" role="alert">
                  {errorMessage}
                </div>
              )}

              {adminContact && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#92400e' }}>
                    <ShieldAlert size={16} />
                    <span>Contact Your Administrator</span>
                  </div>
                  <p style={{ fontSize: '12.5px', color: '#78350f', margin: 0, lineHeight: 1.5 }}>
                    Automated email delivery is currently not connected in system settings.
                    Please contact your CRM administrator to reset your password directly from the Admin panel:
                  </p>
                  <div style={{ background: '#ffffff', border: '1px solid #fef3c7', padding: '8px 12px', borderRadius: '6px', fontSize: '12.5px', color: '#0f172a' }}>
                    <strong>{adminContact.name}</strong>
                    {adminContact.email && <span style={{ color: '#64748b', marginLeft: '6px' }}>({adminContact.email})</span>}
                  </div>
                </div>
              )}

              <div className="security-input-group">
                <label className="security-input-label">Work Account Email</label>
                <div className="security-input-wrapper">
                  <input
                    type="email"
                    className="security-text-input"
                    placeholder="e.g. rahul@company.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errorMessage) setErrorMessage('');
                    }}
                    autoFocus
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>

            <div className="security-upgrade-footer">
              <button
                type="button"
                className="security-btn-skip"
                onClick={handleClose}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="security-btn-save"
                disabled={isLoading || !email}
              >
                {isLoading ? (
                  'Checking...'
                ) : (
                  <>
                    <Mail size={14} />
                    <span>Send Reset Code</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleResetPassword}>
            <div className="security-upgrade-body">
              {errorMessage && (
                <div className="security-error-banner" role="alert">
                  {errorMessage}
                </div>
              )}

              <div className="security-input-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="security-input-label">6-Digit Code</label>
                  <button
                    type="button"
                    onClick={handleRequestCode}
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '11.5px', cursor: 'pointer', padding: 0 }}
                    disabled={isLoading}
                  >
                    Resend code
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className="security-text-input"
                  style={{ textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.3em', fontSize: '18px', fontWeight: 600 }}
                  placeholder="••••••"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    if (errorMessage) setErrorMessage('');
                  }}
                  autoFocus
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="security-input-group">
                <label className="security-input-label">New Password</label>
                <div className="security-input-wrapper">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="security-text-input"
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (errorMessage) setErrorMessage('');
                    }}
                    autoComplete="new-password"
                    disabled={isLoading}
                    required
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
                <label className="security-input-label">Confirm New Password</label>
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
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="security-upgrade-footer">
              <button
                type="button"
                className="security-btn-skip"
                onClick={() => setStep(1)}
                disabled={isLoading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <ArrowLeft size={13} />
                <span>Back</span>
              </button>
              <button
                type="submit"
                className="security-btn-save"
                disabled={isLoading || code.length !== 6 || !newPassword}
              >
                {isLoading ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

