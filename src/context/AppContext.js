import React, { createContext, useContext, useState, useEffect } from 'react';
import { getToken, removeToken } from '../lib/auth';
import { api } from '../lib/api';
import { logActivity } from '../lib/logActivity';

const AppContext = createContext(null);

// The Splash spinner is blocked on authReady, so this await is the whole app's
// cold-start critical path. Shorter than api.js's default: a returning user waiting
// on a wedged network is better served by onboarding than by a spinner.
const BOOTSTRAP_TIMEOUT_MS = 8000;

export function AppProvider({ children }) {
  const [analysis,      setAnalysis]      = useState(null);
  const [srProducts,    setSrProducts]    = useState(null);
  const [shelfAnalysis, setShelfAnalysis] = useState(null);
  const [answers,       setAnswers]       = useState(null);
  const [user,          setUser]          = useState(null);
  const [authReady,     setAuthReady]     = useState(false);
  // Set when persisting the assessment failed after retries — ProfileScreen shows a
  // non-blocking banner so the user knows the result may not be there next time.
  const [analysisSaveFailed, setAnalysisSaveFailed] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        try {
          const { user: u } = await api.get('/api/auth/me', { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
          // Rehydrate the latest saved analysis so a page refresh doesn't blank the app
          try {
            const { analysis: saved } = await api.get('/api/analysis/latest', { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
            if (saved) setAnalysis(saved);
          } catch { /* no saved analysis yet — fine */ }
          setUser(u);
          logActivity('app_open');
        } catch (err) {
          // Only a rejected or orphaned token means "signed out". A timeout or a dead
          // network must not silently log the user out — they keep the token and
          // simply start this cold boot in onboarding.
          if (err?.status === 401 || err?.status === 404) await removeToken();
        }
      }
      setAuthReady(true);
    })();
  }, []);

  async function logout() {
    await removeToken();
    setUser(null);
    setAnalysis(null);
    setSrProducts(null);
    setShelfAnalysis(null);
    setAnswers(null);
    setAnalysisSaveFailed(false);
  }

  return (
    <AppContext.Provider value={{
      analysis,      setAnalysis,
      srProducts,    setSrProducts,
      shelfAnalysis, setShelfAnalysis,
      answers,       setAnswers,
      user,          setUser,
      authReady,
      analysisSaveFailed, setAnalysisSaveFailed,
      logout,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
