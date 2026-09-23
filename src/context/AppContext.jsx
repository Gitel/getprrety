import React, { createContext, useContext, useState, useEffect } from 'react';
import { removeToken } from '../lib/auth';
import { loadSession } from '../lib/loadSession';
import { logActivity } from '../lib/logActivity';

const AppContext = createContext(null);
const BOOTSTRAP_TIMEOUT_MS = 8000;

export function AppProvider({ children }) {
  // srProducts / shelfAnalysis live on `analysis` (see analyzeWithRailway.js), not here.
  const [analysis, setAnalysis] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [analysisSaveFailed, setAnalysisSaveFailed] = useState(false);
  // Session cache for Profile's AI product recommendations: { key, recs, country } or null.
  // Profile can now be reopened from Home, and each open used to call the paid,
  // rate-limited (10/h) recommendations endpoint again. Memory only: a reload refetches.
  const [productRecsCache, setProductRecsCache] = useState(null);

  useEffect(() => {
    (async () => {
      // User AND saved analysis are both loaded before authReady flips, so SplashScreen
      // can send a returning user straight to Home (see loadSession.js for the race this
      // fixes). Worst case is one BOOTSTRAP_TIMEOUT_MS, under SplashScreen's 10 s ceiling.
      const { user: signedInUser, analysis: saved } = await loadSession({ timeoutMs: BOOTSTRAP_TIMEOUT_MS });
      if (saved) setAnalysis(saved);
      if (signedInUser) {
        setUser(signedInUser);
        logActivity('app_open');
      }
      setAuthReady(true);
    })();
  }, []);

  async function logout() {
    await removeToken();
    setUser(null);
    setAnalysis(null);
    setAnswers(null);
    setAnalysisSaveFailed(false);
    setProductRecsCache(null);
  }

  return (
    <AppContext.Provider value={{
      analysis, setAnalysis,
      answers, setAnswers,
      user, setUser,
      authReady,
      analysisSaveFailed, setAnalysisSaveFailed,
      productRecsCache, setProductRecsCache,
      logout,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
