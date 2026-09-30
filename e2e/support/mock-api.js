// The mocked backend, done with Playwright request routing (no real server, no real network).
//
// ONE route handler on the browser context sees every request the page makes:
//   - the app's own origin (the vite preview server)   -> passed through untouched;
//   - MOCK_API_ORIGIN (VITE_API_URL of the test build)  -> answered by handleApi() below;
//   - the Railway analysis service                      -> 503 (app uses its fallback plan) or held;
//   - Google Fonts CSS / Google Identity script         -> empty 200;
//   - anything else                                     -> aborted and recorded as "blocked".
//
// The API lives on another origin than the app, so every response carries CORS headers and
// OPTIONS preflights are answered with 204.
//
// Response shapes mirror server/routes/* of the app; the data is in fixtures-data.js.
import * as fx from './fixtures-data.js';

export const MOCK_API_ORIGIN = 'http://api.e2e.test';
const RAILWAY_HOST = 'getpretty-api-production.up.railway.app';

// Authorization must be listed by name: "*" does not cover it in a preflight.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// Same hash as src/lib/homeRoutine.js routineKeyFor (FNV-1a 32 bit over the step names).
// Copied (not imported) so the tests do not depend on app source.
function routineKeyFor(amNames, pmNames) {
  const text = JSON.stringify([amNames, pmNames]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

// Step names the app shows for the fixture routine (see routineSteps in homeRoutine.js).
function srStepNames(analysis, tab) {
  return (analysis.srProducts?.[tab] || []).map(s => (s.sr_product_id ? s.sr_product_name : s.routine_category));
}

// Fresh mutable state for one test. Tests can override any field with mock.set({...}).
function defaultState() {
  return {
    analysis: fx.ANALYSIS,                          // null -> GET /api/analysis/latest answers 404
    messages: fx.MESSAGES.map(m => ({ ...m })),     // POST /api/messages appends to this copy
    unread: 1,                                      // number the messages badge shows
    ticks: fx.PROGRESS_TICKS,                       // today's routine ticks; null -> nothing ticked
  };
}

export function createMock({ appOrigin }) {
  let state = defaultState();
  const calls = [];               // every call to the mock API: { method, path, query, body, authed }
  const unmocked = [];            // "METHOD /path" of API calls this mock does not know
  const blockedHosts = new Set(); // other origins the page tried to reach (aborted)
  let railwayMode = 'fail';       // what /analyze-skin answers: 'fail' | 'hang'
  const railwayPending = [];      // held /analyze-skin requests while mode is 'hang'

  const json = (route, status, body) => route.fulfill({
    status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body ?? {}),
  });

  // ---- the API ----------------------------------------------------------------------------
  async function handleApi(route, request) {
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const key = `${method} ${path}`;
    let body = {};
    try { body = request.postDataJSON() ?? {}; } catch { /* no or non-JSON body */ }
    const authed = request.headers().authorization === `Bearer ${fx.TOKEN}`;
    calls.push({ method, path, query: Object.fromEntries(url.searchParams), body, authed });

    // Answers 401 (and returns true) when the request has no valid token.
    const deny = () => { if (authed) return false; json(route, 401, { error: 'Unauthorized' }); return true; };

    // --- auth / profile ---
    if (key === 'POST /api/auth/login' || key === 'POST /api/auth/signup' || key === 'POST /api/auth/google') {
      return json(route, key.endsWith('signup') ? 201 : 200, { token: fx.TOKEN, user: fx.USER });
    }
    if (key === 'GET /api/auth/me' || key === 'GET /api/profile') {
      return deny() || json(route, 200, { user: fx.USER });
    }
    if (key === 'PATCH /api/profile') {
      return deny() || json(route, 200, { user: { ...fx.USER, ...body } });
    }

    // --- analysis ---
    if (key === 'GET /api/analysis/latest') {
      if (deny()) return undefined;
      return state.analysis ? json(route, 200, { analysis: state.analysis }) : json(route, 404, { error: 'No analysis found' });
    }
    if (key === 'POST /api/analysis') {
      if (deny()) return undefined;
      // The server stores what the client sends and adds _id / createdAt / firstReadingAt.
      return json(route, 201, {
        analysis: { ...body, _id: 'analysis-saved', createdAt: '2026-09-29T09:00:00.000Z', firstReadingAt: '2026-09-29T09:00:00.000Z' },
      });
    }
    if (key === 'POST /api/ai/product-recommendations') {
      return deny() || json(route, 200, fx.PRODUCT_RECS);
    }

    // --- skin scan (unauthenticated init/start/poll, like the real routes) ---
    if (key === 'POST /api/skin-scan/init') return json(route, 201, { scanId: 'scan-1', scanToken: 'scan-token', angles: ['front'] });
    if (/^POST \/api\/skin-scan\/[^/]+\/start$/.test(key)) return json(route, 200, { scanId: 'scan-1', status: 'processing' });
    if (/^POST \/api\/skin-scan\/[^/]+\/claim$/.test(key)) return json(route, 200, { scanId: 'scan-1' });
    if (/^GET \/api\/skin-scan\/[^/]+$/.test(key)) return json(route, 200, { status: 'complete', skinScan: fx.SKIN_SCAN });

    // --- messages ---
    if (key === 'GET /api/messages') return deny() || json(route, 200, { messages: state.messages });
    if (key === 'GET /api/messages/unread-count') return deny() || json(route, 200, { count: state.unread });
    if (key === 'POST /api/messages/read') return deny() || json(route, 200, { ok: true });
    if (key === 'POST /api/messages') {
      if (deny()) return undefined;
      const message = { id: `m-new-${state.messages.length}`, from: 'user', body: String(body.body || ''), createdAt: '2026-09-29T09:00:00.000Z', readAt: null };
      state.messages.push(message);
      return json(route, 201, { message });
    }

    // --- routine progress (Home ticks) ---
    if (key === 'GET /api/routine-progress') {
      if (deny()) return undefined;
      const date = url.searchParams.get('date');
      if (!state.ticks || !state.analysis || date !== fx.TODAY) return json(route, 200, { progress: null });
      return json(route, 200, {
        progress: {
          date,
          routineKey: routineKeyFor(srStepNames(state.analysis, 'am'), srStepNames(state.analysis, 'pm')),
          am: state.ticks.am,
          pm: state.ticks.pm,
        },
      });
    }
    if (key === 'PUT /api/routine-progress') {
      if (deny()) return undefined;
      return json(route, 200, { progress: { date: body.date, routineKey: body.routineKey, am: body.am || [], pm: body.pm || [] } });
    }

    // --- check-ins, activity, uploads, products, cities ---
    if (key === 'POST /api/checkins') {
      if (deny()) return undefined;
      return json(route, 201, { checkIn: { _id: 'checkin-1', mood: 'Calm', createdAt: '2026-09-29T09:00:00.000Z' } });
    }
    if (key === 'GET /api/checkins') {
      if (deny()) return undefined;
      return json(route, 200, { checkIns: [{ _id: 'checkin-0', mood: 'Glowing', createdAt: '2026-09-28T09:00:00.000Z' }] });
    }
    if (key === 'POST /api/activity') return json(route, 200, { ok: true });
    if (key === 'POST /api/uploads') return json(route, 201, { uploadId: 'upload-1' });
    if (key === 'POST /api/products') return json(route, 201, { product: { _id: 'product-1' } });
    if (key === 'GET /api/products') return json(route, 200, { products: [] });
    if (key === 'GET /api/cities/autocomplete') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      return json(route, 200, fx.CITIES.filter(c => c.city.toLowerCase().startsWith(q)));
    }

    // Unknown endpoint: answer 404 and remember it; the test fails at teardown.
    unmocked.push(key);
    return json(route, 404, { error: 'Not found (e2e mock)' });
  }

  // ---- everything that is not the API ------------------------------------------------------
  async function handleExternal(route, u) {
    // The analysis service on Railway. Failing makes the app use its built-in fallback plan.
    if (u.hostname === RAILWAY_HOST) {
      if (u.pathname === '/analyze-skin' && railwayMode === 'hang') {
        railwayPending.push(route); // released later by mock.releaseAnalysis()
        return undefined;
      }
      return route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: '{"error":"e2e: analysis service is offline"}' });
    }
    // Empty but successful, so the page does not wait on them (the Google button stays empty).
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.hostname === 'accounts.google.com') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });

    blockedHosts.add(u.host);
    return route.abort('blockedbyclient');
  }

  // The single router installed on the context.
  async function router(route, request) {
    const u = new URL(request.url());
    if (u.origin === appOrigin) return route.fallback(); // the app itself
    // CORS preflight for any mocked / external origin.
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (u.origin === MOCK_API_ORIGIN) return handleApi(route, request);
    return handleExternal(route, u);
  }

  // ---- the object tests use (exposed as the `mock` fixture) --------------------------------
  return {
    router,

    // Overrides state before (or after) navigation, e.g. mock.set({ analysis: null, unread: 0 }).
    set(overrides) { state = { ...state, ...overrides }; },
    // Current state (e.g. mock.state.messages after a send).
    get state() { return state; },

    // Call log helpers. Filter with a method and an exact path.
    get calls() { return calls; },
    callsTo(method, path) { return calls.filter(c => c.method === method && c.path === path); },
    lastCall(method, path) { return this.callsTo(method, path).at(-1); },

    // Analysis service (Railway) control: hold the /analyze-skin request, then release it.
    holdAnalysis() { railwayMode = 'hang'; },
    async releaseAnalysis() {
      railwayMode = 'fail';
      for (const route of railwayPending.splice(0)) {
        await route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: '{"error":"e2e: analysis service is offline"}' }).catch(() => {});
      }
    },

    // Used by the teardown check in test.js.
    unmocked: () => [...unmocked],
    blockedHosts: () => [...blockedHosts],
  };
}
