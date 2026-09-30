import { getToken } from './auth';

const BASE = process.env.VITE_API_URL || 'http://localhost:3001';

// A stalled socket must never settle "never". Callers await this on paths the user
// is watching — the app bootstrap behind the Splash spinner, the assessment save
// behind the Era reveal — so an unbounded request is a hang with no escape.
const DEFAULT_TIMEOUT_MS = 15000;

async function request(method, path, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Carry the status on the error: withRetry needs it to tell a transient 5xx
      // from a 400 that will be rejected identically on every attempt.
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      // Machine-readable reason from the server (e.g. 'invalid_credentials') plus values for
      // its text (e.g. { min: 8 }). errorText() turns these into a translated message.
      // Old servers send neither, so both may be undefined.
      err.code = data.code;
      err.params = data.params;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      // 408 so isRetryable() treats a timeout as worth another attempt.
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutErr.status = 408;
      timeoutErr.code = 'timeout'; // errorText() maps this to a translated message
      throw timeoutErr;
    }
    // fetch() itself rejects with a TypeError when there is no connection (offline, DNS, CORS).
    // Server errors above have a status; this one never reached the server.
    if (err instanceof TypeError && err.status == null) err.code = 'network';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get:    (path, opts)       => request('GET',    path, undefined, opts),
  post:   (path, body, opts) => request('POST',   path, body,      opts),
  patch:  (path, body, opts) => request('PATCH',  path, body,      opts),
  put:    (path, body, opts) => request('PUT',    path, body,      opts),
  delete: (path, opts)       => request('DELETE', path, undefined, opts),
};
