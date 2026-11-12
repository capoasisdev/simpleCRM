import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { verifyUserCredentials } from '../lib/auth.js';
import ForgotPasswordModal from './common/ForgotPasswordModal';
import '../styles/login.css';

export default function LoginView({ onLoginSuccess, initialEmail = '' }) {
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (initialEmail && emailRef.current) {
      emailRef.current.value = initialEmail;
    }
  }, [initialEmail]);
  const [errorMessage, setErrorMessage] = useState('');
  const [successNotification, setSuccessNotification] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isForgotOpen, setIsForgotOpen] = useState(false);

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErrorMessage('');
    setSuccessNotification('');

    const rawEmail = emailRef.current ? emailRef.current.value : '';
    const rawSecret = passwordRef.current ? passwordRef.current.value : '';

    const trimmedEmail = rawEmail.trim().toLowerCase();
    const trimmedSecret = rawSecret.trim();

    if (!trimmedEmail || !trimmedSecret) {
      setErrorMessage('Please enter both your work account and password or PIN.');
      return;
    }

    setIsLoading(true);

    try {
      // Dual-mode authentication supporting hashed passwords and legacy PINs
      const result = await verifyUserCredentials(trimmedEmail, trimmedSecret);

      if (!result.success) {
        setIsLoading(false);
        setErrorMessage(result.error || 'Invalid credentials. Please contact your admin.');
        return;
      }

      setIsLoading(false);
      onLoginSuccess(result.user, {
        needsPasswordSetup: result.needsPasswordSetup,
        isLegacyPin: result.isLegacyPin,
        company: result.company
      });
    } catch (err) {
      console.error('Login verification error:', err);
      setIsLoading(false);
      setErrorMessage('Unable to verify credentials. Please try again.');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  return (
    <main className="login-page">
      {/* Left Column: Minimal Form */}
      <section className="login-form-section" aria-label="Sign In Section">
        <div className="login-form-container">
          <h1 className="brand-heading">simplecrm</h1>

          <div className="login-form">
            {/* Dummy hidden inputs to absorb browser autofill heuristic scanners */}
            <input type="text" name="fake_username_sink" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
            <input type="password" name="fake_password_sink" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />

            {successNotification && (
              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: '12px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', lineHeight: 1.4 }}>
                {successNotification}
              </div>
            )}

            <div className="form-group">
              <span className="form-label">
                WORK ACCOUNT ID
              </span>
              <div className="input-wrapper">
                <input
                  ref={emailRef}
                  id="crm-account-field"
                  name="crm_account_token"
                  type="text"
                  inputMode="text"
                  className="input-field"
                  placeholder="Enter work email or ID"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  data-lpignore="true"
                  data-form-type="other"
                  data-1p-ignore="true"
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span className="form-label" style={{ marginBottom: 0 }}>
                  PASSWORD / ACCESS PIN
                </span>
                <button
                  type="button"
                  onClick={() => setIsForgotOpen(true)}
                  style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11.5px', cursor: 'pointer', padding: 0, textDecoration: 'underline', transition: 'color 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#0f172a')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
                >
                  Forgot password?
                </button>
              </div>
              <div className="input-wrapper">
                <input
                  ref={passwordRef}
                  id="login-passcode-input"
                  name="passcode_token"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field password-input"
                  placeholder="Enter password or 4-digit PIN"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  data-lpignore="true"
                  data-form-type="other"
                  data-1p-ignore="true"
                  onKeyDown={handleKeyDown}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={0}
                >
                  {showPassword ? (
                    <EyeOff size={18} strokeWidth={1.5} />
                  ) : (
                    <Eye size={18} strokeWidth={1.5} />
                  )}
                </button>
              </div>
            </div>

            <button
              type="button"
              className="submit-btn"
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? 'Verifying...' : 'Sign In'}
            </button>

            {errorMessage && (
              <div className="form-feedback-error" role="alert">
                {errorMessage}
              </div>
            )}

            <div style={{ textAlign: 'center', marginTop: '32px', fontSize: '11px', color: '#94a3b8', letterSpacing: '0.04em', userSelect: 'none' }}>
              simplecrm v1.0.14 (Secure Auth)
            </div>
          </div>
        </div>
      </section>

      {/* Right Column: Architectural Sculpture Render */}
      <section className="login-visual-section" aria-hidden="true">
        <img
          src="/hero-sculpture.jpg"
          alt="Architectural minimalist monolith and fluted glass composition"
          className="hero-sculpture-img"
          loading="eager"
        />
      </section>

      {/* Forgot Password Modal */}
      <ForgotPasswordModal
        isOpen={isForgotOpen}
        initialEmail={emailRef.current ? emailRef.current.value : ''}
        onClose={() => setIsForgotOpen(false)}
        onSuccess={() => {
          setSuccessNotification('Password reset successfully. Please sign in with your new password.');
        }}
      />
    </main>
  );
}
