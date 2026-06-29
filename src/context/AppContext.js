import React, { createContext, useContext, useState, useEffect } from 'react';
import { getToken, removeToken } from '../lib/auth';
import { api } from '../lib/api';
import { logActivity } from '../lib/logActivity';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [analysis,      setAnalysis]      = useState(null);
  const [srProducts,    setSrProducts]    = useState(null);
  const [shelfAnalysis, setShelfAnalysis] = useState(null);
  const [answers,       setAnswers]       = useState(null);
  const [user,          setUser]          = useState(null);
  const [authReady,     setAuthReady]     = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token) {
        try {
          const { user: u } = await api.get('/api/auth/me');
          setUser(u);
          logActivity('app_open');
          // Rehydrate the latest saved analysis so a page refresh doesn't blank the app
          try {
            const { analysis: saved } = await api.get('/api/analysis/latest');
            if (saved) setAnalysis(saved);
          } catch { /* no saved analysis yet — fine */ }
        } catch {
          await removeToken();
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
  }

  return (
    <AppContext.Provider value={{
      analysis,      setAnalysis,
      srProducts,    setSrProducts,
      shelfAnalysis, setShelfAnalysis,
      answers,       setAnswers,
      user,          setUser,
      authReady,
      logout,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
