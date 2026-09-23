import { getToken, removeToken } from './auth';
import { api } from './api';

// Restores the signed-in session at app start: the user AND their saved analysis.
//
// Both must be known before AppContext flips authReady, because SplashScreen routes the
// moment it does and sends a signed-in user without an analysis to the quiz. The analysis
// used to be fetched fire-and-forget after /me, so it always arrived after that decision
// and returning users never reached Home (the routine dashboard).
//
// The two requests run in parallel, so the worst case stays one timeoutMs.
// Returns { user, analysis }; either may be null.
export async function loadSession({ timeoutMs }) {
  const token = await getToken();
  if (!token) return { user: null, analysis: null };

  // A 404 ("no analysis yet") or any failure resolves to null: the user goes to the
  // quiz entry, exactly as before. It never fails the session restore.
  const savedAnalysis = api.get('/api/analysis/latest', { timeoutMs })
    .then(({ analysis }) => analysis || null)
    .catch(() => null);

  try {
    const { user } = await api.get('/api/auth/me', { timeoutMs });
    return { user, analysis: await savedAnalysis };
  } catch (error) {
    // Token no longer valid (or user deleted): forget it. Other errors (offline, 5xx)
    // keep the token so the next launch can try again.
    if (error?.status === 401 || error?.status === 404) await removeToken();
    return { user: null, analysis: null };
  }
}
