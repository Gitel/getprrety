// In-app booking, the app side. Every route needs a signed-in user (requireAuth) and acts
// only on that user (req.user.id). The rules live in services/bookings.js; this file only
// maps its results to HTTP status codes and error bodies.
const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const bookings = require('../services/bookings');
const { consumeRateLimit } = require('../services/rateLimit');

// Each error keeps its English text (`error`) and a stable snake_case `code` (plus `params`
// for values inside the text) so the app can show it in the user's language.
const ERRORS = {
  booking_disabled:     { status: 404, error: 'Booking is not available right now.' },
  account_not_found:    { status: 404, error: 'Account not found' },
  slot_taken:           { status: 409, error: 'Sorry, that time was just taken. Please choose another.' },
  limit_reached:        { status: 409, error: 'You already have an upcoming consultation. To change it, message the clinic.' },
  slot_invalid:         { status: 422, error: 'That time is not available. Please choose another.' },
  invalid_range:        { status: 400, error: 'Choose a valid range of dates.' },
  note_too_long:        { status: 400, error: 'The note can be up to 300 characters.', params: { max: 300 } },
  calendar_unavailable: { status: 503, error: 'We cannot reach the clinic calendar right now. Please try again in a moment.' },
  booking_rate_limited: { status: 429, error: 'Too many requests. Please wait a little and try again.' },
  booking_load_failed:  { status: 500, error: 'Unable to load bookings' },
  booking_failed:       { status: 500, error: 'Unable to book the consultation' },
};

// Sends the error body for a code from the table above.
function sendError(res, code) {
  const e = ERRORS[code];
  const payload = { error: e.error, code };
  if (e.params) payload.params = e.params;
  return res.status(e.status).json(payload);
}

// GET /api/bookings/config - lets the app menu decide whether to show "Book a consultation".
// When booking is off the answer is exactly { enabled: false }, nothing else.
router.get('/config', requireAuth, async (req, res) => {
  try {
    const config = await bookings.getPublicConfig();
    res.json(config && config.enabled ? config : { enabled: false });
  } catch {
    sendError(res, 'booking_load_failed');
  }
});

// GET /api/bookings/slots?from=YYYY-MM-DD&to=YYYY-MM-DD - free times (clinic local dates).
router.get('/slots', requireAuth, async (req, res) => {
  try {
    // 120 per hour per user; counted before any work (calendar calls cost quota).
    if (!(await consumeRateLimit('booking_slots', req.user.id, 120))) return sendError(res, 'booking_rate_limited');
    const { from, to } = req.query || {};
    const result = await bookings.listSlots({ from, to });
    if (!result.ok) return sendError(res, result.code);
    res.json({ timeZone: result.timeZone, slots: result.slots });
  } catch {
    sendError(res, 'booking_load_failed');
  }
});

// POST /api/bookings { startsAt, note? } - book one consultation.
router.post('/', requireAuth, async (req, res) => {
  try {
    // 10 per hour per user, counted before any work.
    if (!(await consumeRateLimit('booking_create', req.user.id, 10))) return sendError(res, 'booking_rate_limited');
    const result = await bookings.createBooking(req.user.id, req.body || {});
    if (!result.ok) return sendError(res, result.code);
    res.status(201).json({ booking: result.booking, warning: result.warning });
  } catch {
    sendError(res, 'booking_failed');
  }
});

// GET /api/bookings/mine - the user's upcoming booking (or null) and past ones.
router.get('/mine', requireAuth, async (req, res) => {
  try {
    res.json(await bookings.listMine(req.user.id));
  } catch {
    sendError(res, 'booking_load_failed');
  }
});

module.exports = router;
