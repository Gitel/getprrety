// The mocked backend, done with Playwright request routing (no real server, no real network).
//
// ONE route handler on the browser context sees every request the page makes:
//   - the app's own origin (the vite preview server)   -> passed through untouched;
//   - MOCK_API_ORIGIN (VITE_API_URL of the test build)  -> answered by handleApi() below;
//   - the Bedrock analysis API route                     -> 503 (app uses its fallback plan) or held;
//   - Google Fonts CSS / Google Identity script         -> empty 200;
//   - anything else                                     -> aborted and recorded as "blocked".
//
// The API lives on another origin than the app, so every response carries CORS headers and
// OPTIONS preflights are answered with 204.
//
// Response shapes mirror server/routes/* of the app; the data is in fixtures-data.js.
import * as fx from './fixtures-data.js';
import { FIXED_ISO } from './page-init.js';

export const MOCK_API_ORIGIN = 'http://api.e2e.test';
// The fake Shopify store the checkout link points at, and how long a payment hold lasts.
const CHECKOUT_HOST = 'shop.e2e.test';
const CHECKOUT_BASE = `https://${CHECKOUT_HOST}/cart/12345:1`;
const HOLD_MINUTES = 15;

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
    user: { ...fx.USER },                           // the signed-in user (/auth/me, /profile, login)
    // In-app booking. slotTakenOnce: the NEXT POST answers 409 slot_taken (and drops that slot).
    booking: { enabled: true, slots: fx.BOOKING_SLOTS.map(sl => ({ ...sl })), upcoming: null, past: [], slotTakenOnce: false },
  };
}

export function createMock({ appOrigin }) {
  let state = defaultState();
  const calls = [];               // every call to the mock API: { method, path, query, body, authed }
  const unmocked = [];            // "METHOD /path" of API calls this mock does not know
  const blockedHosts = new Set(); // other origins the page tried to reach (aborted)
  let analysisMode = 'fail';      // what /api/ai/analyze-skin answers: 'fail' | 'hang'
  const analysisPending = [];     // held analysis requests while mode is 'hang'
  const overrides = new Map();    // "METHOD /path" -> { status, body }, see mock.override()
  const delays = new Map();       // "METHOD /path" -> [ms, ...] one-shot answer delays, see mock.delay()

  // "Now" as the page sees it: the page clock starts at FIXED_ISO and keeps running, so the mock
  // (which runs in Node) adds the real time elapsed since it was created.
  const startedAt = Date.now();
  const nowIso = () => new Date(Date.parse(FIXED_ISO) + (Date.now() - startedAt)).toISOString();

  // Puts the slot of a booking back into the free-slot list (kept sorted by start time).
  const releaseSlot = ({ startsAt, endsAt, date, time }) => {
    if (state.booking.slots.some(sl => sl.startsAt === startsAt)) return;
    state.booking.slots = [...state.booking.slots, { startsAt, endsAt, date, time }]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  };

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

    // A queued mock.delay() holds back the SEND of this answer. The answer itself is still worked
    // out now, from the state at request time, so a test can change the state while it is held.
    const ms = delays.get(key)?.shift();
    if (ms) {
      const realRoute = route;
      route = { fulfill: async opts => { await new Promise(r => setTimeout(r, ms)); return realRoute.fulfill(opts).catch(() => {}); } };
    }

    // A test can replace the answer of one endpoint (mock.override). The call is already logged.
    const forced = overrides.get(key);
    if (forced) return json(route, forced.status, forced.body);

    // Answers 401 (and returns true) when the request has no valid token. Same bodies as
    // server/middleware/auth.js: no Bearer header vs. a wrong token.
    const deny = () => {
      if (authed) return false;
      const hasBearer = (request.headers().authorization || '').startsWith('Bearer ');
      json(route, 401, hasBearer
        ? { error: 'Invalid or expired token', code: 'auth_invalid' }
        : { error: 'No token provided', code: 'auth_required' });
      return true;
    };

    // --- auth / profile ---
    if (key === 'POST /api/auth/signup') {
      // A brand-new account, shaped like toPublicUser(newUser) in server/routes/auth.js: the
      // email is trimmed + lower-cased, there is no skincareTiming yet and language is null.
      const name = typeof body.firstName === 'string' ? body.firstName.trim() : '';
      state.user = {
        _id: 'user-new', id: 'user-new', ...(name ? { firstName: name } : {}),
        email: String(body.email || '').trim().toLowerCase(),
        termsAcceptedAt: body.consentAcceptedAt, consentVersion: body.consentVersion,
        skincareTiming: null, language: null,
      };
      return json(route, 201, { token: fx.TOKEN, user: state.user });
    }
    if (key === 'POST /api/auth/login' || key === 'POST /api/auth/google') {
      // toPublicUser always includes language (null when the user never chose one).
      return json(route, 200, { token: fx.TOKEN, user: { ...state.user, language: state.user.language ?? null } });
    }
    if (key === 'POST /api/auth/link/redeem') {
      // Sign-in links (shapes like server/routes/auth.js). The call (with its body) is in mock.calls.
      // After a success the app stores fx.TOKEN, so later authed calls are accepted as usual.
      if (body.token === 'valid-signin-token') {
        return json(route, 200, { token: fx.TOKEN, user: { ...state.user, language: state.user.language ?? null }, isNew: false });
      }
      if (body.token === 'invite-token') {
        // A first-time invite needs the consent stamp; without it the link is NOT consumed.
        if (!body.consentAcceptedAt) {
          return json(route, 400, { error: 'Please accept the terms and privacy policy.', code: 'consent_required' });
        }
        state.user = {
          _id: 'user-invited', id: 'user-invited', firstName: 'Noa', email: 'noa@example.test',
          termsAcceptedAt: body.consentAcceptedAt, consentVersion: body.consentVersion,
          skincareTiming: null, language: null,
        };
        return json(route, 201, { token: fx.TOKEN, user: state.user, isNew: true });
      }
      return json(route, 400, { error: 'This link is no longer valid.', code: 'link_invalid' });
    }
    if (key === 'GET /api/auth/me' || key === 'GET /api/profile') {
      return deny() || json(route, 200, { user: state.user });
    }
    if (key === 'PATCH /api/profile') {
      if (deny()) return undefined;
      state.user = { ...state.user, ...body };
      return json(route, 200, { user: state.user });
    }

    // --- analysis ---
    if (key === 'POST /api/ai/analyze-skin') {
      if (analysisMode === 'hang') {
        analysisPending.push(route);
        return undefined;
      }
      return json(route, 503, { error: 'e2e: analysis service is offline' });
    }
    if (key === 'GET /api/analysis/latest') {
      if (deny()) return undefined;
      return state.analysis ? json(route, 200, { analysis: state.analysis }) : json(route, 404, { error: 'No analysis found' });
    }
    if (key === 'POST /api/analysis') {
      if (deny()) return undefined;
      // The server stores what the client sends and adds _id / createdAt / firstReadingAt.
      const saved = { ...body, _id: 'analysis-saved', createdAt: '2026-09-29T09:00:00.000Z', firstReadingAt: '2026-09-29T09:00:00.000Z' };
      state.analysis = saved;
      return json(route, 201, { analysis: saved });
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
    if (key === 'POST /api/messages/read') {
      if (deny()) return undefined;
      // Like markReadByUser in server/services/messages.js: clinic messages get a readAt.
      const readAt = nowIso();
      for (const m of state.messages) if (m.from === 'admin' && !m.readAt) m.readAt = readAt;
      state.unread = 0;
      return json(route, 200, { ok: true });
    }
    if (key === 'POST /api/messages') {
      if (deny()) return undefined;
      const message = { id: `m-new-${state.messages.length}`, from: 'user', body: String(body.body || ''), createdAt: '2026-09-29T09:00:00.000Z', readAt: null };
      state.messages.push(message);
      return json(route, 201, { message });
    }

    // --- in-app booking (shapes like server/routes/bookings.js) ---
    if (key === 'GET /api/bookings/config') {
      if (deny()) return undefined;
      return json(route, 200, state.booking.enabled
        ? { enabled: true, slotMinutes: 30, leadHours: 12, horizonDays: 30, timeZone: 'Asia/Jerusalem' }
        : { enabled: false });
    }
    if (key === 'GET /api/bookings/slots') {
      if (deny()) return undefined;
      if (!state.booking.enabled) return json(route, 404, { error: 'Booking is not available right now.', code: 'booking_disabled' });
      return json(route, 200, { timeZone: 'Asia/Jerusalem', slots: state.booking.slots });
    }
    if (key === 'GET /api/bookings/mine') {
      if (deny()) return undefined;
      return json(route, 200, { upcoming: state.booking.upcoming, past: state.booking.past });
    }
    if (key === 'POST /api/bookings') {
      if (deny()) return undefined;
      const b = state.booking;
      if (!b.enabled) return json(route, 404, { error: 'Booking is not available right now.', code: 'booking_disabled' });
      // The limit only applies to a CONFIRMED upcoming booking. A live hold is simply replaced below.
      if (b.upcoming && b.upcoming.status === 'confirmed') {
        return json(route, 409, { error: 'You already have an upcoming consultation.', code: 'limit_reached' });
      }
      const slot = b.slots.find(sl => sl.startsAt === body.startsAt);
      if (b.slotTakenOnce) {
        // Someone else got there first: the slot disappears and the flag resets.
        b.slots = b.slots.filter(sl => sl.startsAt !== body.startsAt);
        b.slotTakenOnce = false;
        return json(route, 409, { error: 'Sorry, that time was just taken. Please choose another.', code: 'slot_taken' });
      }
      if (!slot) return json(route, 422, { error: 'That time is not available. Please choose another.', code: 'slot_invalid' });
      // A second booking replaces the user's live hold: the old hold's slot goes back to the list.
      if (b.upcoming && b.upcoming.status === 'pending_payment') releaseSlot(b.upcoming);
      // The paid flow: the booking starts as a 15 minute hold with a Shopify checkout link.
      const booking = {
        id: 'booking-new', startsAt: slot.startsAt, endsAt: slot.endsAt, date: slot.date, time: slot.time,
        status: 'pending_payment', note: String(body.note || ''),
        holdExpiresAt: new Date(Date.parse(nowIso()) + HOLD_MINUTES * 60_000).toISOString(),
        checkoutUrl: `${CHECKOUT_BASE}?attributes%5Bgetpretty_booking%5D=booking-new&checkout%5Bemail%5D=${encodeURIComponent(state.user.email)}`,
      };
      b.upcoming = booking;
      b.slots = b.slots.filter(sl => sl.startsAt !== body.startsAt);
      return json(route, 201, { booking, warning: state.analysis ? null : 'no_analysis' });
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
    if (key === 'POST /api/activity') return deny() || json(route, 201, { log: {} });
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
    // The Shopify checkout host: a tiny page so the pop-up loads (and is not counted as blocked).
    if (u.hostname === CHECKOUT_HOST) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>e2e checkout</body></html>' });
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
    // Shallow-merges into the booking state, e.g. mock.booking({ enabled: false }) or
    // mock.booking({ upcoming: fx.BOOKING_UPCOMING }).
    booking(patch) { state.booking = { ...state.booking, ...patch }; },
    // Current state (e.g. mock.state.messages after a send).
    get state() { return state; },

    // Forces the answer of one endpoint until mock.clearOverride() (persistent, not one-shot):
    //   mock.override('POST', '/api/messages', 500, { error: 'boom' });
    // The call still appears in mock.calls. method is upper-case, path has no query string.
    override(method, path, status, body) { overrides.set(`${method} ${path}`, { status, body }); },
    clearOverride(method, path) { overrides.delete(`${method} ${path}`); },
    // Delays the answer of the NEXT call to one endpoint by ms (one-shot; call again to queue more):
    //   mock.delay('GET', '/api/bookings/config', 1500);
    delay(method, path, ms) {
      const key = `${method} ${path}`;
      delays.set(key, [...(delays.get(key) || []), ms]);
    },

    // Call log helpers. Filter with a method and an exact path.
    get calls() { return calls; },
    callsTo(method, path) { return calls.filter(c => c.method === method && c.path === path); },
    lastCall(method, path) { return this.callsTo(method, path).at(-1); },

    // Hold the same backend analysis route the app uses, then release it into fallback.
    holdAnalysis() { analysisMode = 'hang'; },
    async releaseAnalysis() {
      analysisMode = 'fail';
      for (const route of analysisPending.splice(0)) {
        await route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: '{"error":"e2e: analysis service is offline"}' }).catch(() => {});
      }
    },

    // Paid flow helpers (what the Shopify webhook / the hold sweep do on the real server):
    //   payBooking(): the live hold becomes a confirmed booking (no hold time, no checkout link).
    //   expireHold(): the hold runs out; upcoming is gone and its slot is free again.
    payBooking() {
      const up = state.booking.upcoming;
      if (up) state.booking.upcoming = { ...up, status: 'confirmed', holdExpiresAt: null, checkoutUrl: null };
    },
    expireHold() {
      const up = state.booking.upcoming;
      if (!up) return;
      releaseSlot(up);
      state.booking.upcoming = null;
    },

    // Used by the teardown check in test.js.
    unmocked: () => [...unmocked],
    blockedHosts: () => [...blockedHosts],
  };
}
