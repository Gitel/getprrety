// In-app booking rules (the "business logic"). Routes only translate the results of these
// functions into HTTP. Everything that touches the outside world (database models, Google
// Calendar, the clock) is passed in as the LAST argument `deps`, so tests can use fakes.
//
// Results are { ok: true, ... } or { ok: false, code }.
const Booking = require('../models/Booking');
const BookingConfig = require('../models/BookingConfig');
const User = require('../models/User');
const SkinAnalysis = require('../models/SkinAnalysis');
const realCalendar = require('./calendar');
const realSlots = require('./slots');
const { isDuplicateStartsAt } = require('./duplicateKey');

// Log-safe text of a calendar error: only Google's reason and the HTTP status, e.g.
// "(Google: notFound, status 404)". Logs must never get the error object, request or user data, or the key.
const calendarDetail = err => realCalendar.describeCalendarError(err);

const MINUTE = 60 * 1000;
const LIST_CAP = 500; // most rows an admin list (or the user card) returns
const DAY = 24 * 60 * MINUTE;
const NOTE_MAX = 300;
// How long a slot is held for a client who has not paid yet (minutes). After this the hold
// expires and the slot is free for everybody again.
const HOLD_MINUTES = 15;

// Fills in the real dependencies; a test passes only the ones it wants to fake.
function withDefaults(deps = {}) {
  return {
    Booking, BookingConfig, User, SkinAnalysis, calendar: realCalendar, slots: realSlots,
    now: () => new Date(),
    ...deps,
  };
}

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

// The single settings document. Created from DEFAULTS the first time anyone asks (upsert, so
// two requests racing on a fresh database cannot create two).
async function getConfig(deps) {
  const d = withDefaults(deps);
  return d.BookingConfig.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: d.BookingConfig.DEFAULTS },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

// Payment goes through the clinic's Shopify store, so booking needs all three settings: the
// store URL, the variant id of the consultation product and the secret that signs webhooks.
function shopifyConfigured() {
  return Boolean(process.env.SHOPIFY_STORE_URL
    && process.env.SHOPIFY_CONSULTATION_VARIANT_ID
    && process.env.SHOPIFY_WEBHOOK_SECRET);
}

// Booking is ON only when the env flag is set, the calendar AND Shopify are configured and the
// clinic has not switched it off in the admin settings.
async function isBookingEnabled(deps) {
  const d = withDefaults(deps);
  if (!['1', 'true'].includes(process.env.BOOKING_ENABLED)) return false;
  if (!d.calendar.isConfigured()) return false;
  if (!shopifyConfigured()) return false;
  const config = await getConfig(d);
  return Boolean(config.enabled);
}

// One line for the server log at boot: is booking on, and if not, WHICH settings are missing
// (names only, never values). The clinic's own on/off switch lives in the database, so it is not checked here.
function bookingBootLine(deps) {
  const d = withDefaults(deps);
  const missing = [];
  if (!['1', 'true'].includes(process.env.BOOKING_ENABLED)) missing.push('BOOKING_ENABLED (must be 1)');
  if (!d.calendar.isConfigured()) {
    if (!process.env.GOOGLE_CALENDAR_ID) missing.push('GOOGLE_CALENDAR_ID');
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON_B64');
  }
  for (const name of ['SHOPIFY_STORE_URL', 'SHOPIFY_CONSULTATION_VARIANT_ID', 'SHOPIFY_WEBHOOK_SECRET']) {
    if (!process.env[name]) missing.push(name);
  }
  if (missing.length) return `booking disabled: missing ${missing.join(', ')}`;
  return `booking enabled (${realCalendar.isMockMode() ? 'mock calendar' : 'Google calendar'})`;
}

// What the app may know: five safe fields, or just { enabled: false }.
async function getPublicConfig(deps) {
  const d = withDefaults(deps);
  if (!(await isBookingEnabled(d))) return { enabled: false };
  const c = await getConfig(d);
  return {
    enabled: true, slotMinutes: c.slotMinutes, leadHours: c.leadHours, horizonDays: c.horizonDays, timeZone: c.timeZone,
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

// A 'YYYY-MM-DD' string plus n days (pure date maths in UTC).
const addDays = (dateStr, n) => new Date(Date.parse(dateStr) + n * DAY).toISOString().slice(0, 10);

// A "live hold" is a booking waiting for payment whose 15 minutes have not run out yet.
const isLiveHold = (b, now) => b.status === 'pending_payment'
  && Boolean(b.holdExpiresAt) && new Date(b.holdExpiresAt).getTime() > now.getTime();

// Mongo filter for the rows that BLOCK a slot ("taken"): confirmed bookings, plus holds that are
// still live. An expired hold (even one the sweep has not flipped to 'expired' yet) never blocks.
// Spread it into a bigger filter, e.g. { ...takenFilter(now), startsAt: { $gt: now } }.
const takenFilter = now => ({
  $or: [{ status: 'confirmed' }, { status: 'pending_payment', holdExpiresAt: { $gt: now } }],
});

// Link that opens the Shopify cart with the consultation product and our booking id attached as
// a note attribute (the paid-order webhook reads it back). Built when the booking is READ, so
// nothing about it is stored. Null when Shopify is not configured.
function buildCheckoutUrl(bookingId, email) {
  const store = (process.env.SHOPIFY_STORE_URL || '').replace(/\/+$/, '');
  const variant = process.env.SHOPIFY_CONSULTATION_VARIANT_ID;
  if (!store || !variant) return null;
  const params = { 'attributes[getpretty_booking]': bookingId };
  if (email) params['checkout[email]'] = email; // pre-fills the email on the Shopify checkout page
  return `${store}/cart/${variant}:1?${new URLSearchParams(params)}`;
}

// What the app sees of a booking. date/time are the CLINIC wall clock, never the device's.
// `user` (optional, needs .email) is only used for the checkout link. `now` is the clock.
function publicBooking(b, timeZone, slots, user, now = new Date()) {
  const local = slots.localParts(new Date(b.startsAt), timeZone);
  const live = isLiveHold(b, now);
  return {
    id: String(b._id),
    startsAt: new Date(b.startsAt).toISOString(),
    endsAt: new Date(b.endsAt).toISOString(),
    date: local.date,
    time: local.time,
    status: b.status,
    note: b.note || '',
    holdExpiresAt: live ? new Date(b.holdExpiresAt).toISOString() : null,
    checkoutUrl: live ? buildCheckoutUrl(String(b._id), user && user.email) : null,
  };
}

// Calendar event text. ONLY the first name, email, the client's own note and the admin link:
// never quiz answers, skin analysis or any health data.
function eventText(user, note, userId) {
  const lines = ['Booked in the GetPretty app.', `Email: ${user.email}`];
  if (note) lines.push(`Note: ${note}`);
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (base) lines.push(`Client page: ${base}/admin/users/${userId}`);
  return {
    summary: `Consultation - ${user.firstName || 'client'}`,
    description: lines.join('\n'),
  };
}

// Removes a booking row. Never throws: if even this fails we log the id so a human can clean up.
async function removeRow(d, id, why) {
  try {
    await d.Booking.deleteOne({ _id: id });
  } catch (err) {
    console.error(`Booking ${id} could not be removed after ${why} (${err && err.name})`); // name only: messages can hold data
  }
}

// Flips every hold whose 15 minutes ran out to 'expired' (frees the slot in the database too).
// Cheap and idempotent, so it runs at the start of every read/create and from the 60 s sweep.
async function expireHolds(deps) {
  const d = withDefaults(deps);
  await d.Booking.updateMany(
    { status: 'pending_payment', holdExpiresAt: { $lte: d.now() } },
    { $set: { status: 'expired' } },
  );
}

// ---------------------------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------------------------

// Free slots for a range of clinic-local dates. from/to optional (default: today .. the last day
// the booking window reaches, i.e. the clinic-local date of now + horizonDays).
async function listSlots({ from, to } = {}, deps) {
  const d = withDefaults(deps);
  if (!(await isBookingEnabled(d))) return { ok: false, code: 'booking_disabled' };
  await expireHolds(d); // stale holds must not hide slots
  const config = await getConfig(d);
  const now = d.now();

  const fromDate = from === undefined ? d.slots.localParts(now, config.timeZone).date : from;
  // Default end: the local date of "now + horizonDays". Slots after that exact moment are still dropped by computeSlots.
  let toDate = to;
  if (to === undefined) {
    toDate = d.slots.localParts(new Date(now.getTime() + config.horizonDays * DAY), config.timeZone).date;
    if (d.slots.isDateString(fromDate) && fromDate > toDate) toDate = fromDate; // a start past the window just has no slots
  }
  if (!d.slots.isDateString(fromDate) || !d.slots.isDateString(toDate) || fromDate > toDate) {
    return { ok: false, code: 'invalid_range' };
  }
  if ((Date.parse(toDate) - Date.parse(fromDate)) / DAY > 31) return { ok: false, code: 'invalid_range' };

  // The whole range as instants: local midnight of `from` up to local midnight after `to`.
  const rangeStart = d.slots.zonedToUtc(fromDate, '00:00', config.timeZone);
  const rangeEnd = d.slots.zonedToUtc(addDays(toDate, 1), '00:00', config.timeZone);

  let busy;
  try {
    busy = await d.calendar.getBusy({ start: rangeStart, end: rangeEnd });
  } catch (err) {
    console.error(`booking: calendar_unavailable while listing slots ${calendarDetail(err)}`);
    return { ok: false, code: 'calendar_unavailable' }; // any calendar failure
  }
  // A day of margin before the range, so a booking that started just before still blocks.
  // "Taken" = confirmed OR a live hold (somebody is paying for it right now).
  const booked = await d.Booking.find({
    ...takenFilter(now), startsAt: { $gte: new Date(rangeStart.getTime() - DAY), $lt: rangeEnd },
  }).lean();

  // One pass over the grid: free times go to `slots` (unchanged meaning, so old app builds keep
  // working) and blocked ones to `taken` (busy calendar time, confirmed booking or live hold) so
  // the calendar view can grey them out. Only the 4 public fields are sent, never why it is taken.
  const grid = d.slots.computeGrid({ now, fromDate, toDate, config, busy, booked });
  const publicFields = ({ startsAt, endsAt, date, time }) => ({ startsAt, endsAt, date, time });
  const slots = grid.filter(s => !s.taken).map(publicFields);
  const taken = grid.filter(s => s.taken).map(publicFields);
  return { ok: true, timeZone: config.timeZone, slots, taken };
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

// The ordered steps are documented in the contract (section 2); numbers below match it.
// A new booking is only a HOLD ('pending_payment') for HOLD_MINUTES. It becomes 'confirmed' (and
// gets its calendar event) when Shopify tells us the order was paid (see bookingPayments.js).
async function createBooking(userId, { startsAt, note } = {}, deps) {
  const d = withDefaults(deps);

  // 1. Cheap validation first. Nothing below runs if any of this fails.
  if (!(await isBookingEnabled(d))) return { ok: false, code: 'booking_disabled' };
  if (note !== undefined && note !== null && typeof note !== 'string') return { ok: false, code: 'note_too_long' };
  const cleanNote = (note || '').trim();
  if (cleanNote.length > NOTE_MAX) return { ok: false, code: 'note_too_long' };
  const start = typeof startsAt === 'string' ? new Date(startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return { ok: false, code: 'slot_invalid' };
  const user = await d.User.findById(userId).select('email firstName').lean();
  if (!user) return { ok: false, code: 'account_not_found' };

  // 1b. Free the slots of holds that ran out, so they do not count as taken below.
  await expireHolds(d);
  const now = d.now();

  // 1c. The client picked a NEW time while still holding an old one: give the old hold back first,
  //     otherwise step 2 would reject them for "already having" a booking.
  await d.Booking.updateMany(
    { userId, status: 'pending_payment', holdExpiresAt: { $gt: now } },
    { $set: { status: 'expired' } },
  );

  // Rows that count against the one-booking limit: a confirmed upcoming booking or a live hold.
  const upcomingFilter = { userId, startsAt: { $gt: now }, ...takenFilter(now) };

  // 2. One upcoming consultation per client.
  if (await d.Booking.exists(upcomingFilter)) return { ok: false, code: 'limit_reached' };

  // 3. Is this start a real slot (grid, opening hours, lead time, horizon)? Busy/booked ignored here.
  const config = await getConfig(d);
  const wanted = start.toISOString();
  const localDate = d.slots.localParts(start, config.timeZone).date;
  const grid = d.slots.computeSlots({ now, fromDate: localDate, toDate: localDate, config, busy: [], booked: [] });
  const slot = grid.find(s => s.startsAt === wanted);
  if (!slot) return { ok: false, code: 'slot_invalid' };
  const end = new Date(slot.endsAt);

  // 4. Fresh availability: ask the calendar again (no cache) and re-read confirmed bookings and live holds.
  const bufferMs = config.bufferMinutes * MINUTE;
  const rangeStart = new Date(start.getTime() - bufferMs);
  const rangeEnd = new Date(end.getTime() + bufferMs);
  let busy;
  try {
    busy = await d.calendar.getBusy({ start: rangeStart, end: rangeEnd }, { fresh: true });
  } catch (err) {
    console.error(`booking: calendar_unavailable while checking the slot ${calendarDetail(err)}`);
    return { ok: false, code: 'calendar_unavailable' }; // nothing was written yet
  }
  const booked = await d.Booking.find({
    ...takenFilter(now), startsAt: { $gte: new Date(rangeStart.getTime() - DAY), $lt: rangeEnd },
  }).lean();
  const stillFree = d.slots.computeSlots({ now, fromDate: localDate, toDate: localDate, config, busy, booked });
  if (!stillFree.some(s => s.startsAt === wanted)) return { ok: false, code: 'slot_taken' };

  // Known limit (accepted for phase 1): the unique index only stops an IDENTICAL startsAt. With a buffer
  // or right after a slot-length change, two simultaneous requests for different but overlapping
  // starts can both get through. No lock is used.
  // 5. Claim the slot with a HOLD. The unique partial indexes on startsAt (one for confirmed rows,
  //    one for pending_payment rows) make this atomic: if two people get here together, the
  //    database rejects the second one. No calendar event yet: it is written after payment.
  let booking;
  try {
    booking = await d.Booking.create({
      userId,
      startsAt: start,
      endsAt: end,
      status: 'pending_payment',
      holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * MINUTE),
      payment: { status: 'awaiting' },
      calendarEventId: null,
      note: cleanNote,
    });
  } catch (err) {
    if (isDuplicateStartsAt(err)) return { ok: false, code: 'slot_taken' };
    throw err;
  }

  // 6. Race guard: two requests of the SAME user may both pass step 2. Keep only one: the EARLIER
  //    row (smaller _id = created first). Both requests compute the same winner, so exactly one
  //    row survives and only the later request is answered with limit_reached.
  const upcomingRows = await d.Booking.find(upcomingFilter).select('_id').lean();
  const earliestId = upcomingRows.map(r => String(r._id)).sort()[0];
  if (upcomingRows.length > 1 && String(booking._id) !== earliestId) {
    await removeRow(d, booking._id, 'limit race');
    return { ok: false, code: 'limit_reached' };
  }

  // (Steps 7-8, the calendar event, moved to bookingPayments.js: it is created once the booking is paid.)

  // 9. Soft warning (never a block) when the client has not done the skin analysis yet.
  const hasAnalysis = await d.SkinAnalysis.exists({ userId });
  return {
    ok: true,
    booking: publicBooking(booking, config.timeZone, d.slots, user, now),
    warning: hasAnalysis ? null : 'no_analysis',
  };
}

// ---------------------------------------------------------------------------------------------
// The signed-in client's own bookings
// ---------------------------------------------------------------------------------------------
async function listMine(userId, deps) {
  const d = withDefaults(deps);
  await expireHolds(d);
  const now = d.now();
  const config = await getConfig(d);
  const user = await d.User.findById(userId).select('email').lean(); // the checkout link pre-fills the email
  // upcoming = the live hold if there is one (the client must pay it), otherwise the next confirmed booking.
  const [hold] = await d.Booking.find({ userId, status: 'pending_payment', holdExpiresAt: { $gt: now } })
    .sort({ startsAt: 1 }).limit(1).lean();
  const [next] = hold ? [hold] : await d.Booking.find({ userId, status: 'confirmed', startsAt: { $gt: now } })
    .sort({ startsAt: 1 }).limit(1).lean();
  const past = await d.Booking.find({ userId, status: 'confirmed', startsAt: { $lte: now } })
    .sort({ startsAt: -1 }).limit(20).lean();
  return {
    upcoming: next ? publicBooking(next, config.timeZone, d.slots, user, now) : null,
    past: past.map(b => publicBooking(b, config.timeZone, d.slots, user, now)),
  };
}

// ---------------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------------

// Turns booking documents into admin table rows (adds the client's email and first name).
async function toAdminRows(bookings, d) {
  const config = await getConfig(d);
  const ids = [...new Set(bookings.map(b => String(b.userId)))];
  const users = ids.length ? await d.User.find({ _id: { $in: ids } }).select('email firstName').lean() : [];
  const byId = new Map(users.map(u => [String(u._id), u]));
  return bookings.map(b => {
    const u = byId.get(String(b.userId)) || {};
    const pub = publicBooking(b, config.timeZone, d.slots, undefined, d.now());
    const pay = b.payment || {};
    return {
      id: pub.id,
      userId: String(b.userId),
      userEmail: u.email || '',
      userFirstName: u.firstName || '',
      startsAt: pub.startsAt,
      endsAt: pub.endsAt,
      date: pub.date,
      time: pub.time,
      note: pub.note,
      status: pub.status,
      cancelledAt: b.cancelledAt || null,
      cancelledByAdminEmail: b.cancelledByAdminEmail || null,
      holdExpiresAt: pub.holdExpiresAt,
      needsAttention: b.needsAttention || null,
      calendarSynced: Boolean(b.calendarEventId), // false on a paid booking = calendar write still pending
      payment: {
        status: pay.status || 'none',
        amount: pay.amount ?? null,
        currency: pay.currency || null,
        providerRef: pay.providerRef || null,
        paidAt: pay.paidAt || null,
      },
    };
  });
}

// tab = upcoming | past | cancelled | attention (anything else is treated as upcoming).
async function listForAdmin({ tab } = {}, deps) {
  const d = withDefaults(deps);
  await expireHolds(d); // an ended hold belongs under "cancelled", not "upcoming"
  const now = d.now();
  const queries = {
    // confirmed future bookings plus holds that are still live
    upcoming: [{
      $or: [
        { status: 'confirmed', startsAt: { $gt: now } },
        { status: 'pending_payment', holdExpiresAt: { $gt: now } },
      ],
    }, 1],
    past: [{ status: 'confirmed', startsAt: { $lte: now } }, -1],
    cancelled: [{ status: { $in: ['cancelled', 'expired'] } }, -1],
    // paid bookings that need a human (slot lost, paid after cancel, extra payment)
    // (rows an admin already marked handled are left out)
    attention: [{ needsAttention: { $ne: null }, attentionHandledAt: null }, -1],
  };
  const [filter, direction] = queries[tab] || queries.upcoming;
  // Capped so a list cannot grow forever: upcoming = the soonest 500, the others = the newest 500.
  const bookings = await d.Booking.find(filter).sort({ startsAt: direction }).limit(LIST_CAP).lean();
  return toAdminRows(bookings, d);
}

// Every booking of one client, newest first (shown on the admin user page).
async function listForUser(userId, deps) {
  const d = withDefaults(deps);
  const bookings = await d.Booking.find({ userId }).sort({ startsAt: -1 }).limit(LIST_CAP).lean();
  return toAdminRows(bookings, d);
}

// Cancel: the calendar event is deleted FIRST. If that fails the booking stays confirmed and
// the admin can simply retry (deleting an event twice is harmless). A booking still waiting for
// payment has no event, so it is only marked cancelled.
async function cancelBooking(id, adminEmail, deps) {
  const d = withDefaults(deps);
  // Plain 24-hex check: mongoose's isValid would also accept any 12-character string.
  if (!/^[a-f\d]{24}$/i.test(String(id))) return { ok: false, code: 'not_found' };
  const booking = await d.Booking.findById(id).lean();
  if (!booking) return { ok: false, code: 'not_found' };
  if (booking.status === 'cancelled' || booking.status === 'expired') return { ok: false, code: 'already_cancelled' };

  if (booking.calendarEventId) {
    try {
      // Delete on the calendar the booking was made on (stored snapshot), not the one configured now.
      await d.calendar.deleteEvent(booking.calendarEventId, booking.calendarId || undefined);
    } catch (err) {
      console.error(`booking: calendar_unavailable cancelling booking ${booking._id}, event ${booking.calendarEventId} ${calendarDetail(err)}`);
      return { ok: false, code: 'calendar_unavailable' };
    }
  }
  const changes = { status: 'cancelled', cancelledAt: d.now(), cancelledByAdminEmail: adminEmail };
  // The update only matches the row in the SAME status we read. That makes a double click / two
  // admins safe (only one matches), and stops an admin from cancelling a hold that was PAID in the
  // same moment (round-2 review N4): the row is then 'confirmed', the filter misses, and the admin
  // is told the booking changed instead of silently cancelling a paid booking.
  const filter = { _id: id, status: booking.status };
  // Race guard: we read the row WITHOUT a calendar event. If the calendar sync writes one
  // between our read and this update, the filter below misses (the row now has an event id) and
  // we must not cancel the row while leaving a live event behind.
  if (!booking.calendarEventId) filter.calendarEventId = null;
  const result = await d.Booking.updateOne(filter, { $set: changes });
  if (result && result.matchedCount === 0) {
    const fresh = await d.Booking.findById(id).lean();
    // The unpaid hold got paid while the admin was cancelling it: do not cancel, ask to re-check.
    if (fresh && booking.status === 'pending_payment' && fresh.status === 'confirmed') {
      return { ok: false, code: 'booking_changed' };
    }
    // Same status, but the calendar sync added an event meanwhile: delete it, then cancel.
    if (!booking.calendarEventId && fresh && fresh.calendarEventId && fresh.status === booking.status) {
      try {
        await d.calendar.deleteEvent(fresh.calendarEventId, fresh.calendarId || undefined);
      } catch (err) {
        console.error(`booking: calendar_unavailable cancelling booking ${fresh._id}, event ${fresh.calendarEventId} ${calendarDetail(err)}`);
        return { ok: false, code: 'calendar_unavailable' };
      }
      const retry = await d.Booking.updateOne({ _id: id, status: booking.status }, { $set: changes });
      if (!retry || retry.matchedCount !== 0) return { ok: true, booking: { ...booking, ...changes } };
    }
    return { ok: false, code: 'already_cancelled' };
  }
  return { ok: true, booking: { ...booking, ...changes } };
}

// Admin "Mark handled" on a Needs attention row: records who dealt with it and when, so the row
// leaves the Needs attention tab. Only a flagged, not-yet-handled row can be marked.
// Result: { ok:true, userId } | { ok:false, code:'not_found' | 'not_flagged' }.
async function markAttentionHandled(id, adminEmail, deps) {
  const d = withDefaults(deps);
  if (!/^[a-f\d]{24}$/i.test(String(id))) return { ok: false, code: 'not_found' };
  const booking = await d.Booking.findById(id).lean();
  if (!booking) return { ok: false, code: 'not_found' };
  // One conditional update: a double click or a second admin simply misses and gets not_flagged.
  const result = await d.Booking.updateOne(
    { _id: id, needsAttention: { $ne: null }, attentionHandledAt: null },
    { $set: { attentionHandledAt: d.now(), attentionHandledByAdminEmail: adminEmail } },
  );
  if (!result || result.matchedCount === 0) return { ok: false, code: 'not_flagged' };
  return { ok: true, userId: booking.userId }; // userId is for the route's audit entry
}

// ---- settings form ----

const NUMBER_FIELDS = [
  ['bufferMinutes', 0, 60],
  ['leadHours', 0, 168],
  ['horizonDays', 1, 30],
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Whole non-negative number from a form string, or null when it is not one.
const wholeNumber = v => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

// Validates the raw form body and, when valid, saves it. Returns the names of the fields that
// really changed (so the route can audit them). Nothing is saved when any field is invalid.
async function updateConfig(input = {}, deps) {
  const d = withDefaults(deps);
  const next = {};

  next.enabled = Boolean(input.enabled); // an unticked checkbox is simply absent from the body
  next.allowSameDay = Boolean(input.allowSameDay); // same: unticked = absent = same-day booking off
  next.slotMinutes = wholeNumber(input.slotMinutes);
  if (!d.BookingConfig.SLOT_MINUTES.includes(next.slotMinutes)) return { ok: false, code: 'invalid' };
  for (const [name, min, max] of NUMBER_FIELDS) {
    const value = wholeNumber(input[name]);
    if (value === null || value < min || value > max) return { ok: false, code: 'invalid' };
    next[name] = value;
  }

  // One window per enabled weekday (0 = Sunday). Times of days left unticked are ignored.
  next.weekly = [];
  for (let day = 0; day <= 6; day += 1) {
    if (!input[`day${day}_enabled`]) continue;
    const open = input[`day${day}_open`];
    const close = input[`day${day}_close`];
    if (!TIME_RE.test(open) || !TIME_RE.test(close) || close <= open) return { ok: false, code: 'invalid' };
    next.weekly.push({ day, open, close });
  }

  const current = await getConfig(d);
  const weeklyKey = w => JSON.stringify([...(w || [])].sort((a, b) => a.day - b.day).map(x => [x.day, x.open, x.close]));
  const changed = ['enabled', 'allowSameDay', 'slotMinutes', 'bufferMinutes', 'leadHours', 'horizonDays', 'weekly'].filter(name => {
    if (name === 'weekly') return weeklyKey(current.weekly) !== weeklyKey(next.weekly);
    // A stored document without allowSameDay counts as false (no DB migration needed).
    if (name === 'allowSameDay') return Boolean(current.allowSameDay) !== next.allowSameDay;
    return current[name] !== next[name];
  });
  if (changed.length) {
    await d.BookingConfig.updateOne({ key: 'main' }, { $set: next }, { upsert: true });
  }
  return { ok: true, changed };
}

// ---------------------------------------------------------------------------------------------
// Account deletion hook (contract section 13)
// ---------------------------------------------------------------------------------------------

// Removes the calendar events of the user's upcoming bookings. Best effort: a failure is logged
// (booking id + event id) and we carry on, because the account must always be deletable.
async function releaseUserBookings(userId, deps) {
  const d = withDefaults(deps);
  const upcoming = await d.Booking.find({
    userId, status: 'confirmed', startsAt: { $gt: d.now() },
  }).lean();
  for (const b of upcoming) {
    if (!b.calendarEventId) continue;
    try {
      await d.calendar.deleteEvent(b.calendarEventId, b.calendarId || undefined);
    } catch (err) {
      console.error(`Booking ${b._id}: calendar event ${b.calendarEventId} could not be removed while deleting the account ${calendarDetail(err)}`);
    }
  }
}

module.exports = {
  HOLD_MINUTES, shopifyConfigured, expireHolds, eventText, publicBooking,
  isBookingEnabled, bookingBootLine, getConfig, getPublicConfig, listSlots, createBooking, listMine,
  listForAdmin, listForUser, cancelBooking, markAttentionHandled, updateConfig, releaseUserBookings,
};
