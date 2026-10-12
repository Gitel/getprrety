import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { removeToken, storeToken } from '../lib/auth';
// Still needed by the resume refresh below (boot itself now goes through loadSession).
import { api } from '../lib/api';
import { loadSession } from '../lib/loadSession';
import { logActivity } from '../lib/logActivity';
import { onAppResume, nextAnalysis, keepIfEqual } from '../lib/resumeRefresh';
import { fetchUnreadCount } from '../lib/messages';
// Sign-in link (#signin=<token> in the URL): read + strip the token, and redeem it.
import { readSigninToken, redeemSigninLink } from '../lib/signinLink';
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

  // Sign-in link hand-off to SplashScreen / LinkWelcomeScreen (see the boot effect below).
  //   afterSignin: 'QuizIntro' once a link signed the user in (one-shot, cleared by Splash).
  //   linkWelcome: { mode: 'invite', token } (new customer must accept the terms first)
  //                or { mode: 'invalid' } (dead link); cleared by LinkWelcomeScreen.
  const [afterSignin, setAfterSignin] = useState(null);
  const [linkWelcome, setLinkWelcome] = useState(null);
  // True while the boot-time redeem is in flight. SplashScreen must not give up and navigate
  // away during this time, or a slow network would hide the invite welcome screen.
  const [linkPending, setLinkPending] = useState(false);
  // Guards the boot effect: React StrictMode runs effects twice in dev, but the URL token is
  // stripped on the first read, so a second read would find nothing.
  const bootStarted = useRef(false);

  // Loads the saved session (token -> user + analysis) into context. Used at boot and again by
  // LinkWelcomeScreen after it stores a token. bootLanguage reads the stored language, runs
  // loadSession, then sets the UI language, so the first screen is already in the right language.
  async function reloadSession() {
    const { user: signedInUser, analysis: saved } = await bootLanguage(
      () => loadSession({ timeoutMs: BOOTSTRAP_TIMEOUT_MS }),
    );
    if (saved) setAnalysis(saved);
    if (signedInUser) {
      setUser(signedInUser);
      logActivity('app_open');
    }
  }

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    (async () => {
      // 1. Sign-in link: BEFORE loadSession, so the session load below already sees the new token.
      //    readSigninToken also removes the token from the address bar immediately.
      const linkToken = readSigninToken();
      if (linkToken) {
        setLinkPending(true);
        try {
          // No consent: existing accounts need none. Normal api.js timeout (15 s) on purpose: the
          // server uses the link up as soon as it answers, so aborting early on a slow network would
          // turn a good link into "link no longer valid" (round-2 review N2). Splash waits for it.
          const res = await redeemSigninLink(linkToken);
          await storeToken(res.token);
          setAfterSignin('QuizIntro'); // Splash sends the user to the quiz landing once
        } catch (err) {
          // New invited customer: they must accept the terms on LinkWelcomeScreen first.
          // Anything else (expired, used, revoked, offline...) shows the "link invalid" screen.
          setLinkWelcome(err?.code === 'consent_required'
            ? { mode: 'invite', token: linkToken }
            : { mode: 'invalid' });
        } finally {
          setLinkPending(false); // result (afterSignin / linkWelcome) is set; Splash may decide now
        }
      }
      // 2. Normal session load. User AND saved analysis are both loaded before authReady flips,
      //    so SplashScreen can send a returning user straight to Home (see loadSession.js).
      //    Worst case: redeem (15 s) + this load (8 s). SplashScreen waits for the redeem
      //    (linkPending, with its own hard ceiling) and may give up during this load like a plain boot.
      await reloadSession();
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
      afterSignin, clearAfterSignin: () => setAfterSignin(null),
      linkWelcome, clearLinkWelcome: () => setLinkWelcome(null),
      linkPending,
      reloadSession,
      logout,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
