import React, { createContext, useContext, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [analysis, setAnalysis] = useState(null);
  const [answers, setAnswers]   = useState(null);
  const [user, setUser]         = useState(null);

  return (
    <AppContext.Provider value={{ analysis, setAnalysis, answers, setAnswers, user, setUser }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
