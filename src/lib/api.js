import { getToken } from './auth';

// Exported so other modules (e.g. catalogueApi photo URLs) build URLs from the same base.
export const BASE = process.env.VITE_API_URL || 'http://localhost:3001';

// A stalled socket must never settle "never". Callers await this on paths the user
// is watching — the app bootstrap behind the Splash spinner, the assessment save
// behind the Era reveal — so an unbounded request is a hang with no escape.
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SSE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_SSE_EVENT_CHARS = 512 * 1024;

// Parse only bounded, complete SSE events. A final analysis can be large, so body and
// individual event limits are generous while still preventing an endless buffer.
async function readAnalysisStream(res, onProgress, streamContext) {
  if (!res.body?.getReader) throw new Error('Streaming response is unavailable');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let eventName = '';
  let dataLines = [];
  let totalBytes = 0;
  let complete = false;
  let analysis = null;

  function dispatch() {
    if (!dataLines.length) { eventName = ''; return; }
    const name = eventName;
    const dataText = dataLines.join('\n');
    eventName = '';
    dataLines = [];
    let data;
    try { data = JSON.parse(dataText); }
    catch { throw new Error('Invalid analysis stream event'); }

    if (name === 'progress') {
      if (['waiting', 'generating', 'validating'].includes(data?.phase)) {
        // The UI receives only a whitelisted phase, never provider text or payload fields.
        const requestId = typeof data.requestId === 'string'
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId)
          ? data.requestId : undefined;
        streamContext.phase = { waiting: 1, generating: 2, validating: 3 }[data.phase];
        if (requestId) streamContext.requestId = requestId;
        onProgress?.({ phase: data.phase, ...(requestId ? { requestId } : {}) });
      }
      return;
    }
    if (name === 'error') {
      const error = new Error(typeof data?.error === 'string' ? data.error.slice(0, 240) : 'Analysis failed');
      if (Number.isInteger(data?.status) && data.status >= 400 && data.status <= 599) error.status = data.status;
      if (typeof data?.code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(data.code)) error.code = data.code;
      throw error;
    }
    if (name === 'complete') {
      if (complete) throw new Error('Duplicate analysis completion event');
      if (!data?.analysis || typeof data.analysis !== 'object' || Array.isArray(data.analysis)) {
        throw new Error('Invalid analysis completion event');
      }
      complete = true;
      analysis = data.analysis;
    }
  }

  function consumeLines() {
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        dispatch();
      } else if (line[0] !== ':') {
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventName = value;
        if (field === 'data') dataLines.push(value);
      }
      if (buffer.length > MAX_SSE_EVENT_CHARS || dataLines.join('\n').length > MAX_SSE_EVENT_CHARS) {
        throw new Error('Analysis stream event is too large');
      }
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SSE_BODY_BYTES) throw new Error('Analysis stream is too large');
      buffer += decoder.decode(value, { stream: true });
      consumeLines();
    }
    buffer += decoder.decode();
    consumeLines();
    // An event without its terminating blank line is incomplete and must not be accepted.
    if (buffer.length || dataLines.length || eventName) throw new Error('Analysis stream ended with an incomplete event');
    if (!complete) throw new Error('Analysis stream ended before completion');
    return analysis;
  } catch (err) {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* the original stream error wins */ }
    throw err;
  } finally {
    reader.releaseLock?.();
  }
}

async function request(method, path, body, { timeoutMs = DEFAULT_TIMEOUT_MS, stream = false, onProgress } = {}) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (stream) headers.Accept = 'text/event-stream, application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const streamContext = { requestId: undefined, phase: undefined };
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let data;
    if (!res.ok) {
      // Keep JSON error bodies readable, but let an abort during body reading reach the
      // timeout handler below instead of turning the timeout into an empty error body.
      try { data = await res.json(); }
      catch (err) { if (err.name === 'AbortError') throw err; data = {}; }
    } else if (stream && res.headers?.get?.('content-type')?.toLowerCase().includes('text/event-stream')) {
      // Keep the caller's original deadline active while consuming the entire event stream.
      data = await readAnalysisStream(res, onProgress, streamContext);
    } else {
      // Some older servers and existing callers still return ordinary JSON.
      data = await res.json().catch(err => { if (err.name === 'AbortError') throw err; return {}; });
    }
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
      if (stream && streamContext.requestId) {
        // Correlation metadata helps support match a timed-out browser stream to the server log.
        console.info('[analysis-stream] timed out', { requestId: streamContext.requestId, phase: streamContext.phase });
      }
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
  // Catalogue products for a list of ids (max 20 per call, see catalogueApi.js). -> { products: [...] }
  catalogueProducts: ids => request('GET', `/api/catalogue/products?ids=${ids.join(',')}`),
};
