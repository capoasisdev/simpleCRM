import { useState, useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import '../styles/login.css';

export default function LoginView({ onLoginSuccess }) {
  const emailRef = useRef(null);
  const pinRef = useRef(null);
  const [showPin, setShowPin] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErrorMessage('');

    const rawEmail = emailRef.current ? emailRef.current.value : '';
    const rawPin = pinRef.current ? pinRef.current.value : '';

    const trimmedEmail = rawEmail.trim().toLowerCase();
    const trimmedPin = rawPin.trim().replace(/\D/g, '').slice(0, 4);

    if (!trimmedEmail || !trimmedPin) {
      setErrorMessage('Please enter both work email and 4-digit PIN.');
      return;
    }

    setIsLoading(true);

    try {
      // Check live Supabase database for user matching email & 4-digit PIN
      const { data, error } = await supabase
        .from('crm_users')
        .select('*')
        .eq('email', trimmedEmail)
        .eq('pin', trimmedPin)
        .maybeSingle();

      if (error) {
        console.error('Supabase authentication error:', error);
        setIsLoading(false);
        setErrorMessage('Unable to verify credentials. Please try again.');
        return;
      }

      if (data) {
        setIsLoading(false);
        onLoginSuccess(data);
        return;
      }

      setIsLoading(false);
      setErrorMessage('Invalid email or 4-digit PIN. Please contact your admin.');
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
                  placeholder="Enter work account"
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
              <span className="form-label">
                4-DIGIT ACCESS PIN
              </span>
              <div className="input-wrapper">
                <input
                  ref={pinRef}
                  id="login-passcode-input"
                  name="passcode_token"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  className={`input-field password-input ${!showPin ? 'pin-masked' : ''}`}
                  placeholder="Enter 4-digit PIN"
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
                  onClick={() => setShowPin(!showPin)}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  tabIndex={0}
                >
                  {showPin ? (
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
              {isLoading ? 'Verifying PIN...' : 'Sign In'}
            </button>

            {errorMessage && (
              <div className="form-feedback-error" role="alert">
                {errorMessage}
              </div>
            )}

            <div style={{ textAlign: 'center', marginTop: '32px', fontSize: '11px', color: '#94a3b8', letterSpacing: '0.04em', userSelect: 'none' }}>
              simplecrm v1.0.13 (Build 14)
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
    </main>
  );
}
