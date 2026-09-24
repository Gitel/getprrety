import React, { createContext, useContext, useState, useEffect } from 'react';
import { getToken, removeToken } from '../lib/auth';
import { api } from '../lib/api';
import { logActivity } from '../lib/logActivity';
import { onAppResume, nextAnalysis, keepIfEqual } from '../lib/resumeRefresh';
import { fetchUnreadCount } from '../lib/messages';

const AppContext = createContext(null);
const BOOTSTRAP_TIMEOUT_MS = 8000;

export function AppProvider({ children }) {
  const [analysis, setAnalysis] = useState(null);
  const [srProducts, setSrProducts] = useState(null);
  const [shelfAnalysis, setShelfAnalysis] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [analysisSaveFailed, setAnalysisSaveFailed] = useState(false);
  // Clinic messages the user has not opened yet (badge on Home's message button).
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Re-read the unread count. Best-effort: a failure keeps the last known count.
  function refreshUnreadMessages() {
    return fetchUnreadCount().then(setUnreadMessages).catch(() => {});
  }

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        try {
          const { user: signedInUser } = await api.get('/api/auth/me', { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
          setUser(signedInUser);
          logActivity('app_open');

          api.get('/api/analysis/latest', { timeoutMs: BOOTSTRAP_TIMEOUT_MS })
            .then(({ analysis: saved }) => { if (saved) setAnalysis(saved); })
            .catch(() => {});
        } catch (error) {
          if (error?.status === 401 || error?.status === 404) await removeToken();
        }
      }
      setAuthReady(true);
    })();
  }, []);

  // Coming back to the foreground: re-read the account and the latest analysis, so edits
  // the clinic made in the admin dashboard show up without restarting the app.
  // Only while signed in; re-subscribes when a different user signs in.
  // Login returns the user as { id } but /api/auth/me returns the raw document { _id },
  // so the key accepts either; keying on `id` alone would never subscribe after a boot.
  const signedInKey = user ? String(user.id || user._id || user.email) : null;
  useEffect(() => {
    if (!signedInKey) return undefined;
    return onAppResume(async () => {
      try {
        const { user: fresh } = await api.get('/api/auth/me', { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
        setUser(prev => keepIfEqual(prev, fresh));
      } catch (error) {
        // Same rule as at boot: a revoked token or a deleted account (an admin can delete
        // accounts) signs the user out. Anything else (offline, timeout) is ignored.
        if (error?.status === 401 || error?.status === 404) await logout();
        return;
      }
      api.get('/api/analysis/latest', { timeoutMs: BOOTSTRAP_TIMEOUT_MS })
        .then(({ analysis: saved }) => setAnalysis(current => nextAnalysis(current, saved)))
        .catch(() => {});
      // New clinic messages may have arrived while the app was in the background.
      refreshUnreadMessages();
    });
  }, [signedInKey]);

  async function logout() {
    await removeToken();
    setUser(null);
    setAnalysis(null);
    setSrProducts(null);
    setShelfAnalysis(null);
    setAnswers(null);
    setAnalysisSaveFailed(false);
    setUnreadMessages(0);
  }

  return (
    <AppContext.Provider value={{
      analysis, setAnalysis,
      srProducts, setSrProducts,
      shelfAnalysis, setShelfAnalysis,
      answers, setAnswers,
      user, setUser,
      authReady,
      analysisSaveFailed, setAnalysisSaveFailed,
      unreadMessages, setUnreadMessages, refreshUnreadMessages,
      logout,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
