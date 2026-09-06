import { getToken } from './auth';

const BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

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
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      // 408 so isRetryable() treats a timeout as worth another attempt.
      const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get:    (path, opts)       => request('GET',    path, undefined, opts),
  post:   (path, body, opts) => request('POST',   path, body,      opts),
  patch:  (path, body, opts) => request('PATCH',  path, body,      opts),
  delete: (path, opts)       => request('DELETE', path, undefined, opts),
};
