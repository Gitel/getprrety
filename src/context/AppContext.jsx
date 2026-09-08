import React, { createContext, useContext, useState, useEffect } from 'react';
import { getToken, removeToken } from '../lib/auth';
import { api } from '../lib/api';
import { logActivity } from '../lib/logActivity';

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
      analysis, setAnalysis,
      srProducts, setSrProducts,
      shelfAnalysis, setShelfAnalysis,
      answers, setAnswers,
      user, setUser,
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
