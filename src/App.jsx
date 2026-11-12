import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import LoginView from './components/LoginView';
import DashboardView from './components/DashboardView';
import DownloadView from './components/DownloadView';
import LandingView from './components/landing/LandingView';
import PricingView from './components/landing/PricingView';
import SecurityUpgradeModal from './components/common/SecurityUpgradeModal';
import TrialExpiredPaywall from './components/billing/TrialExpiredPaywall';
import { fetchAuthenticatedProfile, clearAuthSessionStorage, setActiveCompanyCache } from './lib/auth';
import { getActiveCompany } from './lib/tenant';
import { isCompanyAccessLocked } from './lib/billing';

const SESSION_STORAGE_KEY = 'simplecrm_user_session';

export default function App() {
  const isNativeApp = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();

  const [currentPath, setCurrentPath] = useState(() => {
    const p = window.location.pathname;
    if (isNativeApp && (p === '/' || !p)) {
      return '/login';
    }
    return p;
  });

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeCompany, setActiveCompany] = useState(() => getActiveCompany());
  const [prefillLoginEmail, setPrefillLoginEmail] = useState('');
  const [showSecurityUpgrade, setShowSecurityUpgrade] = useState(false);

  const navigateTo = (path) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
  };

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const handleLoginSuccess = (user, authMeta = {}) => {
    const nextCompany = authMeta.company || (user?.company_id ? { id: user.company_id } : null);
    if (nextCompany) {
      setActiveCompanyCache(nextCompany);
    }
    setActiveCompany(nextCompany || null);
    setPrefillLoginEmail('');
    setCurrentUser(user);
    navigateTo('/dashboard');
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
      console.warn('Could not save session to localStorage:', e);
    }

    // If active legacy user logged in with a PIN, or user must change temporary password on first login
    const isPasswordMissing = !user.is_secured && !user.password_hash;
    if (authMeta.needsPasswordSetup || user.must_change_password || isPasswordMissing) {
      if (user.must_change_password) {
        setShowSecurityUpgrade(true);
      } else {
        try {
          const skipped = sessionStorage.getItem('crm_skipped_pwd_upgrade');
          if (skipped !== 'true') {
            setShowSecurityUpgrade(true);
          }
        } catch {}
      }
    }
  };

  const handleLogout = async () => {
    setCurrentUser(null);
    setActiveCompany(null);
    setShowSecurityUpgrade(false);
    navigateTo(isNativeApp ? '/login' : '/');
    await clearAuthSessionStorage();
  };

  // If user is already logged in and visits /login, redirect to /dashboard
  useEffect(() => {
    if (currentUser && currentPath === '/login') {
      navigateTo('/dashboard');
    }
  }, [currentUser, currentPath]);

  // Prompt active users still using legacy PIN or users who must change temporary password on first login
  useEffect(() => {
    if (currentUser) {
      const isPasswordMissing = !currentUser.is_secured && !currentUser.password_hash;
      if (currentUser.must_change_password) {
        setShowSecurityUpgrade(true);
      } else if (!currentUser.password_updated_at && isPasswordMissing) {
        try {
          const skipped = sessionStorage.getItem('crm_skipped_pwd_upgrade');
          if (skipped !== 'true') {
            setShowSecurityUpgrade(true);
          }
        } catch {}
      }
    }
  }, [currentUser?.id, currentUser?.password_updated_at, currentUser?.password_hash, currentUser?.is_secured, currentUser?.must_change_password]);

  // Verify the logged-in user holds a valid server JWT and refresh profile + company state
  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;
    const verifyUserExists = async () => {
      try {
        const res = await fetchAuthenticatedProfile();

        if (!isMounted) return;

        if (!res.success && (res.error === 'NO_AUTH_SESSION' || res.error === 'INVALID_SESSION')) {
          console.info('Session token missing or expired. Signing out to acquire fresh tenant JWT.');
          await handleLogout();
          return;
        }

        if (res.success && res.user) {
          setCurrentUser(res.user);
          if (res.company) {
            setActiveCompanyCache(res.company);
            setActiveCompany(res.company);
          }
          try {
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(res.user));
          } catch {}
        }
      } catch (err) {
        console.warn('Error verifying session user:', err);
      }
    };

    verifyUserExists();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.id]);

  // 1. Android APK Download Page
  if (currentPath === '/download' || currentPath === '/download/') {
    return (
      <DownloadView
        onGoToWeb={() => navigateTo(currentUser ? '/dashboard' : '/')}
      />
    );
  }

  // 1.5. Pricing Page
  if (currentPath === '/pricing' || currentPath === '/pricing/') {
    return (
      <PricingView
        onGoToHome={() => navigateTo('/')}
        onGoToLogin={(email) => {
          setPrefillLoginEmail(typeof email === 'string' ? email : '');
          navigateTo('/login');
        }}
      />
    );
  }

  // 2. Authenticated Dashboard Session
  if (currentUser) {
    // If logged in user explicitly wants to preview the landing page
    if (currentPath === '/home' || currentPath === '/landing') {
      return (
        <LandingView
          currentUser={currentUser}
          onGoToDashboard={() => navigateTo('/dashboard')}
          onGoToDownload={() => navigateTo('/download')}
          onGoToPricing={() => navigateTo('/pricing')}
          onGoToLogin={() => navigateTo('/dashboard')}
        />
      );
    }

    const effectiveCompany = activeCompany || getActiveCompany();
    if (effectiveCompany && isCompanyAccessLocked(effectiveCompany)) {
      return (
        <TrialExpiredPaywall
          currentUser={currentUser}
          company={effectiveCompany}
          onActivated={(updatedCompany) => {
            if (updatedCompany) {
              setActiveCompanyCache(updatedCompany);
              setActiveCompany(updatedCompany);
            }
          }}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <>
        <DashboardView
          currentUser={currentUser}
          company={effectiveCompany}
          onCompanyUpdated={(updatedCompany) => {
            if (updatedCompany) {
              setActiveCompanyCache(updatedCompany);
              setActiveCompany(updatedCompany);
            }
          }}
          onLogout={handleLogout}
        />
        <SecurityUpgradeModal
          isOpen={showSecurityUpgrade}
          user={currentUser}
          onClose={() => setShowSecurityUpgrade(false)}
          onSuccess={(updatedUser) => {
            setCurrentUser(updatedUser);
            try {
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updatedUser));
            } catch {}
            setShowSecurityUpgrade(false);
          }}
        />
      </>
    );
  }

  // 3. Unauthenticated Login Route (or native mobile app)
  if (currentPath === '/login' || currentPath === '/login/' || isNativeApp) {
    return (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        initialEmail={prefillLoginEmail}
      />
    );
  }

  // 4. Default Web Landing / Homepage
  return (
    <LandingView
      currentUser={null}
      onGoToLogin={() => navigateTo('/login')}
      onGoToDownload={() => navigateTo('/download')}
      onGoToPricing={() => navigateTo('/pricing')}
      onGoToDashboard={() => navigateTo('/dashboard')}
    />
  );
}
