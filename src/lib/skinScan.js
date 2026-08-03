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

  try {
    const initRes = await fetch(`${BASE}/api/skin-scan/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos, quizAnswers }),
    });
    if (!initRes.ok) return null;
    const { scanId, scanToken } = await initRes.json();
    if (!scanId || !scanToken) return null;

    const startRes = await fetch(`${BASE}/api/skin-scan/${scanId}/start`, {
      method: 'POST',
      headers: { 'X-Scan-Token': scanToken },
    });
    if (!startRes.ok) return null;

    return { scanId, scanToken };
  } catch {
    return null;
  }
}

// Single status read — cheap, no vendor call server-side. Callers loop this on their own cadence.
export async function pollScan(scanId, scanToken) {
  if (!scanId) return null;
  try {
    const authToken = await getToken();
    const headers = {};
    if (scanToken) headers['X-Scan-Token'] = scanToken;
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${BASE}/api/skin-scan/${scanId}`, {
      headers,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Attaches a pre-signup scan to the new account. Best-effort — a failure here loses the linkage to
// the user's profile but not the underlying analysis.
export async function claimScan(scanId, scanToken) {
  if (!scanId || !scanToken) return false;
  const token = await getToken();
  const res = await fetch(`${BASE}/api/skin-scan/${scanId}/claim`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Scan-Token': scanToken,
      'Content-Type': 'application/json',
    },
  });
  return res.ok;
}
