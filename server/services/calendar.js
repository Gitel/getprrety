// Google Calendar access for in-app booking: read busy times, create and delete events.
// Env vars are read at CALL time (never at import) so tests can change them freely.
//
// Library choice: @googleapis/calendar (small) + the server's own google-auth-library JWT.
// npm dedupes both to the SAME google-auth-library copy (checked with `npm ls`), so the JWT
// client we build here is passed straight in as `auth` with no version mismatch.
const { calendar: createGoogleCalendar } = require('@googleapis/calendar');
const { JWT } = require('google-auth-library');

const TZ = 'Asia/Jerusalem';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TIMEOUT_MS = 8000; // every Google call is cut off after this long
const CACHE_MS = 45 * 1000; // busy answers are reused for this long

// ---- helpers for CalendarError (the class comment is right below them) ----
// First Google reason in an object's errors[] list (or undefined).
function reasonOf(obj) {
  return obj && Array.isArray(obj.errors) && obj.errors[0] && obj.errors[0].reason;
}

// Network error code (e.g. 'ECONNRESET'): a STRING code on the error or on its own cause.
function networkCodeOf(cause) {
  const hit = [cause, cause && cause.cause].find(e => e && typeof e.code === 'string');
  return hit && hit.code;
}

// Single error type for every calendar problem. `cause` keeps the original error for debugging.
// Messages are fixed text: they must never include the key or anything decoded from it.
// `reason` / `status` are the ONLY details meant for logs: short codes taken from Google's reply,
// or fixed words for our own failures (credentials_invalid, not_configured, timeout).
class CalendarError extends Error {
  constructor(message, cause, reason) {
    super(message);
    this.name = 'CalendarError';
    this.code = 'calendar_unavailable';
    if (cause !== undefined) this.cause = cause;
    // Google's reason (e.g. 'notFound') when we have one, kept only if it is a short plain word.
    // The real client (gaxios) puts Google's errors[] on err.cause, sometimes one level deeper
    // (cause.cause), so every place is checked. A network failure has no reason, only an error
    // code such as ECONNRESET, which is used instead.
    const googleReason = reason || reasonOf(cause) || (cause && reasonOf(cause.cause)) || networkCodeOf(cause);
    if (typeof googleReason === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(googleReason)) this.reason = googleReason;
    // HTTP status of a failed Google call (numbers only).
    const status = cause && Number(cause.code || cause.status || (cause.response && cause.response.status));
    if (Number.isInteger(status) && status >= 100 && status < 600) this.status = status;
  }
}

// Log-safe text for a calendar failure: only the Google reason and HTTP status, like
// "(Google: notFound, status 404)". Never the error object, its message, config or the key.
function describeCalendarError(err) {
  const parts = [];
  if (err && err.reason) parts.push(`Google: ${err.reason}`);
  if (err && err.status) parts.push(`status ${err.status}`);
  return parts.length ? `(${parts.join(', ')})` : '';
}

// Mock mode is a test/dev aid. It is never allowed in production.
function isMockMode() {
  return process.env.BOOKING_CALENDAR_MOCK === '1' && process.env.NODE_ENV !== 'production';
}

function isConfigured() {
  if (isMockMode()) return true;
  return Boolean(process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64);
}

// Runs a Google call but gives up after 8 s. A timeout rejects with a CalendarError.
function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CalendarError('Calendar request timed out', undefined, 'timeout')), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Any failure of a Google call becomes a CalendarError (our own errors pass through unchanged).
function wrap(err) {
  return err instanceof CalendarError ? err : new CalendarError('Calendar request failed', err);
}

// Builds the real Google client from the base64 service-account key. Only called when needed.
// Failures use a fixed message: the key and the parse error are NOT included.
function buildRealClient() {
  try {
    const key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8'));
    const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE] });
    return createGoogleCalendar({ version: 'v3', auth });
  } catch (e) {
    throw new CalendarError('Calendar credentials are invalid', undefined, 'credentials_invalid');
  }
}

// True when a Google error means "event does not exist (any more)".
function isGone(err) {
  const status = Number(err && (err.code || (err.response && err.response.status)));
  return status === 404 || status === 410;
}

// ---------- mock calendar (BOOKING_CALENDAR_MOCK=1, never in production) ----------

// Offset in ms of `tz` from UTC at the given instant (positive = ahead of UTC).
function zoneOffsetMs(date, tz) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)) p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Turns a local wall-clock hour in `tz` into a UTC Date (DST-aware; private to this file).
function localToUtc(y, m, d, hour, tz) {
  const guess = Date.UTC(y, m - 1, d, hour);
  let utc = guess - zoneOffsetMs(new Date(guess), tz);
  utc = guess - zoneOffsetMs(new Date(utc), tz); // second pass fixes days where the offset changes
  return new Date(utc);
}

// Mock busy time: every local day has a 12:00-13:00 block, so tests are deterministic.
function mockBusy({ start, end }) {
  const out = [];
  // Walk calendar days (as plain UTC dates) from one day before to one day after the range.
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - 1));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1);
  for (; day.getTime() <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const s = localToUtc(y, m, d, 12, TZ);
    const e = localToUtc(y, m, d, 13, TZ);
    if (e > start && s < end) out.push({ start: s, end: e }); // keep only blocks touching the range
  }
  return out;
}

// ---------- the service ----------

// `client` is optional: tests inject a fake with the @googleapis/calendar shape.
function createCalendarService({ client } = {}) {
  let realClient = client || null; // built lazily on first real call
  let mockEvents = [];
  let mockCounter = 0;
  const cache = new Map(); // "startISO|endISO" -> { at, busy }
  const useMock = () => isMockMode() && !client;

  function requireReady() {
    if (!isConfigured()) throw new CalendarError('Calendar is not configured', undefined, 'not_configured');
    if (!realClient) realClient = buildRealClient();
    return realClient;
  }

  async function getBusy({ start, end }, { fresh = false } = {}) {
    if (useMock()) return mockBusy({ start, end });
    const g = requireReady();
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    const cacheKey = `${start.toISOString()}|${end.toISOString()}`;
    const hit = cache.get(cacheKey);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.busy;
    try {
      const res = await withTimeout(g.freebusy.query({
        requestBody: { timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: calendarId }] },
      }));
      const cal = res.data && res.data.calendars && res.data.calendars[calendarId];
      // Google can answer HTTP 200 and still report a per-calendar failure (errors) or leave our
      // calendar out. Treating that as "no busy time" would show every slot free, so it is an error.
      // (Thrown before cache.set, so a failed answer is never cached.)
      if (!cal || (Array.isArray(cal.errors) && cal.errors.length)) {
        throw new CalendarError('Calendar busy query failed', undefined, cal && cal.errors && cal.errors[0] && cal.errors[0].reason);
      }
      const busy = (cal.busy || []).map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
      // Drop expired entries first so the cache cannot grow forever, then store this answer.
      for (const [key, entry] of cache) {
        if (Date.now() - entry.at >= CACHE_MS) cache.delete(key);
      }
      cache.set(cacheKey, { at: Date.now(), busy }); // only successful answers are cached
      return busy;
    } catch (e) {
      throw wrap(e);
    }
  }

  async function createEvent({ bookingId, startsAt, endsAt, summary, description }) {
    if (useMock()) {
      const eventId = `mock-event-${++mockCounter}`;
      mockEvents.push({ eventId, bookingId, startsAt, endsAt, summary, description });
      return { eventId };
    }
    const g = requireReady();
    try {
      const res = await withTimeout(g.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        sendUpdates: 'none', // never email anyone; no attendees are set either
        requestBody: {
          summary,
          description,
          start: { dateTime: startsAt.toISOString(), timeZone: TZ },
          end: { dateTime: endsAt.toISOString(), timeZone: TZ },
          extendedProperties: { private: { getprettyBookingId: String(bookingId) } },
        },
      }));
      return { eventId: res.data.id };
    } catch (e) {
      throw wrap(e);
    }
  }

  // Idempotent: an event that is already gone (404/410) counts as deleted.
  // `calendarId` is the calendar the booking was made on (its stored snapshot); it falls back
  // to the configured one for rows that have none.
  async function deleteEvent(eventId, calendarId) {
    if (useMock()) {
      mockEvents = mockEvents.filter(ev => ev.eventId !== eventId);
      return;
    }
    const g = requireReady();
    try {
      await withTimeout(g.events.delete({ calendarId: calendarId || process.env.GOOGLE_CALENDAR_ID, eventId, sendUpdates: 'none' }));
    } catch (e) {
      if (isGone(e)) return;
      throw wrap(e);
    }
  }

  return {
    isConfigured, getBusy, createEvent, deleteEvent, CalendarError,
    // Test helpers for the in-memory mock calendar.
    __mock: {
      events: () => mockEvents.slice(),
      reset: () => { mockEvents = []; mockCounter = 0; cache.clear(); },
      cacheSize: () => cache.size,
    },
  };
}

module.exports = { ...createCalendarService(), createCalendarService, describeCalendarError, isMockMode };
