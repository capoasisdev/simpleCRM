import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import LoginView from './components/LoginView';
import DashboardView from './components/DashboardView';
import DownloadView from './components/DownloadView';
import LandingView from './components/landing/LandingView';
import PricingView from './components/landing/PricingView';
import SecurityUpgradeModal from './components/common/SecurityUpgradeModal';
import MemberTrialSurveyView from './components/billing/MemberTrialSurveyView';
import MasterAdminRoot from './components/master/MasterAdminRoot';
import { fetchAuthenticatedProfile, clearAuthSessionStorage, setActiveCompanyCache } from './lib/auth';
import { attachSupabaseSession } from './lib/supabase';
import { consumeSupportHandoff } from './lib/masterAdmin';
import { getActiveCompany } from './lib/tenant';
import { isCompanyAccessLocked } from './lib/billing';
import { canUserManageBilling } from './lib/permissions';
import { isDirectPortalDomain } from './lib/domainRouting';

const SESSION_STORAGE_KEY = 'simplecrm_user_session';

export default function App() {
  const isNativeApp = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform();
  const isDirectPortal = isDirectPortalDomain();
  const isPortalMode = isNativeApp || isDirectPortal;

  const [currentPath, setCurrentPath] = useState(() => {
    const p = window.location.pathname;
    const isRoot = p === '/' || !p || p === '/home' || p === '/landing';
    if (isPortalMode && isRoot) {
      try {
        const saved = localStorage.getItem(SESSION_STORAGE_KEY);
        const target = saved ? '/dashboard' : '/login';
        if (typeof window !== 'undefined' && window.location.pathname !== target) {
          window.history.replaceState({}, '', target);
        }
        return target;
      } catch {
        return '/login';
      }
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
  const [isAttachingSupportHandoff, setIsAttachingSupportHandoff] = useState(() => {
    try {
      return window.location.search.includes('support=1') && !window.location.pathname.startsWith('/master');
    } catch {
      return false;
    }
  });

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
    navigateTo(isPortalMode ? '/login' : '/');
    await clearAuthSessionStorage();
  };

  // If user is already logged in and visits /login or marketing route on portal domain, redirect to /dashboard
  useEffect(() => {
    if (currentUser) {
      if (currentPath === '/login' || (isPortalMode && (currentPath === '/' || currentPath === '/home' || currentPath === '/landing' || currentPath === '/pricing'))) {
        navigateTo('/dashboard');
      }
    }
  }, [currentUser, currentPath, isPortalMode]);

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

  // Support Session Handoff from /master console (?support=1)
  useEffect(() => {
    if (!isAttachingSupportHandoff) return undefined;
    let active = true;
    const applyHandoff = async () => {
      try {
        const handoff = consumeSupportHandoff();
        if (handoff?.user && handoff?.session) {
          await attachSupabaseSession(handoff.session);
          const supportUser = { ...handoff.user, must_change_password: false };
          if (handoff.company) {
            setActiveCompanyCache(handoff.company);
            if (active) setActiveCompany(handoff.company);
          }
          try {
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(supportUser));
          } catch {}
          if (active) {
            setCurrentUser(supportUser);
            setShowSecurityUpgrade(false);
          }
        }
      } finally {
        try {
          if (window.location.search.includes('support=1')) {
            window.history.replaceState({}, '', '/dashboard');
          }
        } catch {}
        if (active) setIsAttachingSupportHandoff(false);
      }
    };
    applyHandoff();
    return () => {
      active = false;
    };
  }, [isAttachingSupportHandoff]);

  // Verify the logged-in user holds a valid server JWT and refresh profile + company state
  useEffect(() => {
    if (!currentUser || isAttachingSupportHandoff) return;

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
  }, [currentUser?.id, isAttachingSupportHandoff]);

  // 1. Android APK Download Page
  if (currentPath === '/download' || currentPath === '/download/') {
    if (isPortalMode && !currentUser) {
      return (
        <LoginView
          onLoginSuccess={handleLoginSuccess}
          initialEmail={prefillLoginEmail}
        />
      );
    }
    return (
      <DownloadView
        onGoToWeb={() => navigateTo(currentUser ? '/dashboard' : (isPortalMode ? '/login' : '/'))}
      />
    );
  }

  // 1.5. Pricing Page
  if (currentPath === '/pricing' || currentPath === '/pricing/') {
    if (isPortalMode) {
      if (currentUser) {
        return (
          <DashboardView
            currentUser={currentUser}
            company={activeCompany || getActiveCompany()}
            onCompanyUpdated={(updatedCompany) => {
              if (updatedCompany) {
                setActiveCompanyCache(updatedCompany);
                setActiveCompany(updatedCompany);
              }
            }}
            onUserUpdated={(updatedUser) => {
              if (!updatedUser) return;
              setCurrentUser((prev) => {
                const merged = prev ? { ...prev, ...updatedUser } : updatedUser;
                try {
                  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(merged));
                } catch {}
                return merged;
              });
            }}
            onLogout={handleLogout}
          />
        );
      }
      return (
        <LoginView
          onLoginSuccess={handleLoginSuccess}
          initialEmail={prefillLoginEmail}
        />
      );
    }
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

  // 1.75. Platform Master Admin Console (isolated founder session)
  if (currentPath === '/master' || currentPath.startsWith('/master/')) {
    return <MasterAdminRoot />;
  }

  if (isAttachingSupportHandoff) {
    return <div style={{ minHeight: '100vh', background: '#ffffff' }} />;
  }

  // 2. Authenticated Dashboard Session
  if (currentUser) {
    // If logged in user explicitly wants to preview the landing page (only allowed on marketing domains)
    if (!isPortalMode && (currentPath === '/home' || currentPath === '/landing')) {
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
    const isLocked = Boolean(effectiveCompany && isCompanyAccessLocked(effectiveCompany));
    const canManageUsersOrAdmin =
      currentUser?.role === 'admin' ||
      currentUser?.permissions?.admin?.manage_users === true;
    const isAdminOrBillingUser =
      canUserManageBilling(currentUser, effectiveCompany) || canManageUsersOrAdmin;

    if (isLocked && !isAdminOrBillingUser) {
      return (
        <MemberTrialSurveyView
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
          isConversionMode={isLocked && isAdminOrBillingUser}
          onCompanyUpdated={(updatedCompany) => {
            if (updatedCompany) {
              setActiveCompanyCache(updatedCompany);
              setActiveCompany(updatedCompany);
            }
          }}
          onUserUpdated={(updatedUser) => {
            if (!updatedUser) return;
            setCurrentUser((prev) => {
              const merged = prev ? { ...prev, ...updatedUser } : updatedUser;
              try {
                localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(merged));
              } catch {}
              return merged;
            });
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

  // 3. Unauthenticated Login Route (or native mobile app or direct portal domain)
  if (currentPath === '/login' || currentPath === '/login/' || isPortalMode) {
    return (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        initialEmail={prefillLoginEmail}
      />
    );
  }

  // 4. Default Web Landing / Homepage (Primary marketing domain only)
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
