import { getToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// Quiz photos are captured before the user has an account, so init/start/poll are unauthenticated —
// same posture as the existing direct-to-Gemini call in analyzeWithRailway.js. Claiming the scan at
// signup is the one authenticated step, via the shared `api` helper.
function parseDataUrl(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const match = uri.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return null;
  return { contentType: match[1], base64: match[2] };
}

// Matches api.js's default ceiling: these are one-shot calls on the unauthenticated
// init/start path, not a tight poll loop, so there's no reason to cut them shorter.
const SCAN_REQUEST_TIMEOUT_MS = 15000;

// Polled every 1.5s inside a 25s soft-timeout budget (see LoadingScreen), so a long
// ceiling here would defeat that budget — a hung poll should fail fast and let the
// caller's own retry/timeout logic keep driving the loop.
const POLL_TIMEOUT_MS = 5000;

// Fires the PerfectCorp scan in the background as soon as the front photo is captured. Never throws —
// a failure here must never block the quiz, same as every other photo-analysis failure mode today.
export async function initAndStartScan({ front, left, right, quizAnswers }) {
  const photos = [['front', front], ['left', left], ['right', right]]
    .map(([angle, uri]) => {
      const parsed = parseDataUrl(uri);
      return parsed ? { angle, ...parsed } : null;
    })
    .filter(Boolean);

  if (!photos.some(p => p.angle === 'front')) return null;

  const initController = new AbortController();
  const initTimer = setTimeout(() => initController.abort(), SCAN_REQUEST_TIMEOUT_MS);
  try {
    const initRes = await fetch(`${BASE}/api/skin-scan/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos, quizAnswers }),
      signal: initController.signal,
    });
    if (!initRes.ok) return null;
    const { scanId, scanToken } = await initRes.json();
    if (!scanId || !scanToken) return null;

    const startController = new AbortController();
    const startTimer = setTimeout(() => startController.abort(), SCAN_REQUEST_TIMEOUT_MS);
    try {
      const startRes = await fetch(`${BASE}/api/skin-scan/${scanId}/start`, {
        method: 'POST',
        headers: { 'X-Scan-Token': scanToken },
        signal: startController.signal,
      });
      if (!startRes.ok) return null;
    } finally {
      clearTimeout(startTimer);
    }

    return { scanId, scanToken };
  } catch {
    return null;
  } finally {
    clearTimeout(initTimer);
  }
}

// Single status read — cheap, no vendor call server-side. Callers loop this on their own cadence.
export async function pollScan(scanId, scanToken) {
  if (!scanId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  try {
    const authToken = await getToken();
    const headers = {};
    if (scanToken) headers['X-Scan-Token'] = scanToken;
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${BASE}/api/skin-scan/${scanId}`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    // A timeout lands here same as any other network failure — the caller's tick
    // loop reschedules on null, and the soft timeout is what eventually gives up.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Attaches a pre-signup scan to the new account. Best-effort — a failure here loses the linkage to
// the user's profile but not the underlying analysis.
export async function claimScan(scanId, scanToken) {
  if (!scanId || !scanToken) return false;
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/skin-scan/${scanId}/claim`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Scan-Token': scanToken,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    // persistAnalysis awaits this; a hang here must resolve to "not claimed" rather
    // than stranding the caller the way an unbounded fetch would.
    return false;
  } finally {
    clearTimeout(timer);
  }
}
