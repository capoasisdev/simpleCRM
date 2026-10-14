import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import '../styles/login.css';

export default function LoginView({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setIsLoading(true);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPin = pin.trim();

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

  return (
    <main className="login-page">
      {/* Left Column: Minimal Form */}
      <section className="login-form-section" aria-label="Sign In Section">
        <div className="login-form-container">
          <h1 className="brand-heading">simplecrm</h1>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="work-email" className="form-label">
                WORK EMAIL
              </label>
              <div className="input-wrapper">
                <input
                  id="work-email"
                  type="email"
                  className="input-field"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMessage) setErrorMessage('');
                  }}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="user-pin" className="form-label">
                4-DIGIT ACCESS PIN
              </label>
              <div className="input-wrapper">
                <input
                  id="user-pin"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={4}
                  className="input-field password-input"
                  placeholder="Enter 4-digit PIN"
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                    if (errorMessage) setErrorMessage('');
                  }}
                  autoComplete="current-password"
                  required
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

            <button type="submit" className="submit-btn" disabled={isLoading}>
              {isLoading ? 'Verifying PIN...' : 'Sign In'}
            </button>

            {errorMessage && (
              <div className="form-feedback-error" role="alert">
                {errorMessage}
              </div>
            )}
          </form>
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
