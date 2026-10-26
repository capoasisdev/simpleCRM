import { useState, useEffect } from 'react';
import LoginView from './components/LoginView';
import DashboardView from './components/DashboardView';
import DownloadView from './components/DownloadView';
import { supabase } from './lib/supabase';

const SESSION_STORAGE_KEY = 'simplecrm_user_session';

export default function App() {
  const [isDownloadPage, setIsDownloadPage] = useState(() => {
    return window.location.pathname === '/download' || window.location.pathname === '/download/';
  });

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleLocationChange = () => {
      setIsDownloadPage(window.location.pathname === '/download' || window.location.pathname === '/download/');
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    if (window.location.pathname === '/login' || window.location.pathname === '/') {
      window.history.replaceState({}, '', '/dashboard');
    }
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
      console.warn('Could not save session to localStorage:', e);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    window.history.pushState({}, '', '/login');
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {
      console.warn('Could not clear session from localStorage:', e);
    }
  };

  // If user is already logged in and visits /login, redirect to /dashboard
  useEffect(() => {
    if (currentUser && window.location.pathname === '/login') {
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [currentUser]);

  // Verify that the logged-in session user still exists in Supabase crm_users
  useEffect(() => {
    if (!currentUser) return;

    let isMounted = true;
    const verifyUserExists = async () => {
      try {
        let query = supabase.from('crm_users').select('*');
        if (currentUser.id && currentUser.id !== 'admin-default') {
          query = query.eq('id', currentUser.id);
        } else if (currentUser.email) {
          query = query.eq('email', currentUser.email.toLowerCase());
        }

        const { data, error } = await query.maybeSingle();

        if (isMounted) {
          if (!data || error) {
            console.info('Session user does not exist in database. Logging out.');
            handleLogout();
          } else {
            setCurrentUser(data);
            try {
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
            } catch {}
          }
        }
      } catch (err) {
        console.warn('Error verifying session user:', err);
      }
    };

    verifyUserExists();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.id, currentUser?.email]);

  if (isDownloadPage) {
    return (
      <DownloadView
        onGoToWeb={() => {
          setIsDownloadPage(false);
          const target = currentUser ? '/dashboard' : '/login';
          window.history.pushState({}, '', target);
        }}
      />
    );
  }

  return (
    <>
      {!currentUser ? (
        <LoginView onLoginSuccess={handleLoginSuccess} />
      ) : (
        <DashboardView
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}
