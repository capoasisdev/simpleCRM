import { useEffect, useState } from 'react';
import {
  clearMasterSession,
  getStoredMasterSession,
  masterVerifySession,
  saveMasterSession,
} from '../../lib/masterAdmin';
import MasterLoginView from './MasterLoginView';
import MasterAdminShell from './MasterAdminShell';

export default function MasterAdminRoot() {
  const [session, setSession] = useState(() => getStoredMasterSession());
  const [isVerifying, setIsVerifying] = useState(() => Boolean(getStoredMasterSession()?.token));

  useEffect(() => {
    let active = true;
    const stored = getStoredMasterSession();
    if (!stored?.token) {
      setIsVerifying(false);
      return undefined;
    }

    masterVerifySession(stored.token).then((res) => {
      if (!active) return;
      if (res?.success && res?.admin) {
        const nextSession = { token: stored.token, admin: res.admin };
        saveMasterSession(nextSession);
        setSession(nextSession);
      } else {
        clearMasterSession();
        setSession(null);
      }
      setIsVerifying(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const handleLoginSuccess = (newSession) => {
    saveMasterSession(newSession);
    setSession(newSession);
  };

  const handleLogout = () => {
    clearMasterSession();
    setSession(null);
  };

  if (isVerifying) {
    return (
      <main className="master-login-page" aria-busy="true">
        <div className="master-login-container" />
      </main>
    );
  }

  if (!session?.token) {
    return <MasterLoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return <MasterAdminShell session={session} onLogout={handleLogout} />;
}

