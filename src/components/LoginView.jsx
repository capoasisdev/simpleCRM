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
    const trimmedPin = rawPin.trim();

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
            <div className="form-group">
              <label htmlFor="login-identity-input" className="form-label">
                WORK EMAIL
              </label>
              <div className="input-wrapper">
                <input
                  ref={emailRef}
                  id="login-identity-input"
                  name="login_account_id"
                  type="text"
                  inputMode="email"
                  className="input-field"
                  placeholder="Enter your work email"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="login-passcode-input" className="form-label">
                4-DIGIT ACCESS PIN
              </label>
              <div className="input-wrapper">
                <input
                  ref={pinRef}
                  id="login-passcode-input"
                  name="login_access_code"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={4}
                  className="input-field password-input"
                  placeholder="Enter 4-digit PIN"
                  autoComplete="off"
                  onKeyDown={handleKeyDown}
                  onInput={(e) => {
                    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
                  }}
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
