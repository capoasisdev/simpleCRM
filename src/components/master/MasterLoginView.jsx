import { useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { masterLogin } from '../../lib/masterAdmin';
import '../../styles/login.css';
import '../../styles/master.css';

export default function MasterLoginView({ onLoginSuccess }) {
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setErrorMessage('');

    const email = (emailRef.current?.value || '').trim().toLowerCase();
    const password = (passwordRef.current?.value || '').trim();

    if (!email || !password) {
      setErrorMessage('Enter login and password.');
      return;
    }

    setIsLoading(true);
    const res = await masterLogin(email, password);
    setIsLoading(false);

    if (!res?.success || !res?.token) {
      setErrorMessage(res?.error || 'Invalid credentials.');
      return;
    }

    onLoginSuccess({
      token: res.token,
      admin: res.admin,
    });
  };

  return (
    <main className="master-login-page">
      <section className="master-login-container" aria-label="Master Sign In">
        <h1 className="brand-heading">simplecrm</h1>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="master-login-email" className="form-label">
              LOGIN
            </label>
            <div className="input-wrapper">
              <input
                ref={emailRef}
                id="master-login-email"
                type="email"
                className="input-field master-login-input"
                placeholder="Enter email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                autoFocus
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="master-login-password" className="form-label">
              PASSWORD
            </label>
            <div className="input-wrapper">
              <input
                ref={passwordRef}
                id="master-login-password"
                type={showPassword ? 'text' : 'password'}
                className="input-field master-login-input password-input"
                placeholder="Enter password"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff size={20} strokeWidth={1.5} />
                ) : (
                  <Eye size={20} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="submit-btn"
            disabled={isLoading}
          >
            {isLoading ? 'Verifying...' : 'Sign In'}
          </button>

          {errorMessage && (
            <div className="form-feedback-error" role="alert">
              {errorMessage}
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

