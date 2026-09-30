import React, { createContext, useContext, useState, useEffect } from 'react';
import { removeToken } from '../lib/auth';
// Still needed by the resume refresh below (boot itself now goes through loadSession).
import { api } from '../lib/api';
import { loadSession } from '../lib/loadSession';
import { logActivity } from '../lib/logActivity';
import { onAppResume, nextAnalysis, keepIfEqual } from '../lib/resumeRefresh';
import { fetchUnreadCount } from '../lib/messages';
// Language rule (device / account / pending) lives in languageSync.js; this file only calls it.
import { bootLanguage, retryPendingLanguage, clearPendingOnLogout } from '../lib/languageSync';

const AppContext = createContext(null);
const BOOTSTRAP_TIMEOUT_MS = 8000;

export function AppProvider({ children }) {
  // srProducts / shelfAnalysis live on `analysis` (see analyzeWithRailway.js), not here.
  const [analysis, setAnalysis] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [analysisSaveFailed, setAnalysisSaveFailed] = useState(false);
  // Clinic messages the user has not opened yet (badge on Home's message button).
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Session cache for Profile's AI product recommendations: { key, recs, country } or null.
  // Profile can now be reopened from Home, and each open used to call the paid,
  // rate-limited (10/h) recommendations endpoint again. Memory only: a reload refetches.
  const [productRecsCache, setProductRecsCache] = useState(null);

  // Re-read the unread count. Best-effort: a failure keeps the last known count.
  function refreshUnreadMessages() {
    return fetchUnreadCount().then(setUnreadMessages).catch(() => {});
  }

  useEffect(() => {
    (async () => {
      // User AND saved analysis are both loaded before authReady flips, so SplashScreen
      // can send a returning user straight to Home (see loadSession.js for the race this
      // fixes). Worst case is one BOOTSTRAP_TIMEOUT_MS, under SplashScreen's 10 s ceiling.
      // bootLanguage reads the stored language, runs loadSession, then sets the UI language,
      // so the first screen is already in the right language when authReady flips.
      const { user: signedInUser, analysis: saved } = await bootLanguage(
        () => loadSession({ timeoutMs: BOOTSTRAP_TIMEOUT_MS }),
      );
      if (saved) setAnalysis(saved);
      if (signedInUser) {
        setUser(signedInUser);
        logActivity('app_open');
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
        // Retry a language choice that could not be saved earlier. Never changes the UI language.
        retryPendingLanguage();
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
    // Drop an unsaved language choice and show the device language (shared-tablet safety).
    await clearPendingOnLogout();
    setUser(null);
    setAnalysis(null);
    setAnswers(null);
    setAnalysisSaveFailed(false);
    setUnreadMessages(0);
    setProductRecsCache(null);
  }

  return (
    <AppContext.Provider value={{
      analysis, setAnalysis,
      answers, setAnswers,
      user, setUser,
      authReady,
      analysisSaveFailed, setAnalysisSaveFailed,
      unreadMessages, setUnreadMessages, refreshUnreadMessages,
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
