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

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOTE_MAX = 300;

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

// Booking is ON only when the env flag is set, the calendar is configured AND the clinic
// has not switched it off in the admin settings.
async function isBookingEnabled(deps) {
  const d = withDefaults(deps);
  if (!['1', 'true'].includes(process.env.BOOKING_ENABLED)) return false;
  if (!d.calendar.isConfigured()) return false;
  const config = await getConfig(d);
  return Boolean(config.enabled);
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

// What the app sees of a booking. date/time are the CLINIC wall clock, never the device's.
function publicBooking(b, timeZone, slots) {
  const local = slots.localParts(new Date(b.startsAt), timeZone);
  return {
    id: String(b._id),
    startsAt: new Date(b.startsAt).toISOString(),
    endsAt: new Date(b.endsAt).toISOString(),
    date: local.date,
    time: local.time,
    status: b.status,
    note: b.note || '',
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
    console.error(`Booking ${id} could not be removed after ${why}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------------------------

// Free slots for a range of clinic-local dates. from/to optional (default: today .. horizon).
async function listSlots({ from, to } = {}, deps) {
  const d = withDefaults(deps);
  if (!(await isBookingEnabled(d))) return { ok: false, code: 'booking_disabled' };
  const config = await getConfig(d);
  const now = d.now();

  const fromDate = from === undefined ? d.slots.localParts(now, config.timeZone).date : from;
  const toDate = to === undefined ? addDays(fromDate, config.horizonDays - 1) : to;
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
  } catch {
    return { ok: false, code: 'calendar_unavailable' }; // any calendar failure
  }
  // A day of margin before the range, so a booking that started just before still blocks.
  const booked = await d.Booking.find({
    status: 'confirmed', startsAt: { $gte: new Date(rangeStart.getTime() - DAY), $lt: rangeEnd },
  }).lean();

  const slots = d.slots.computeSlots({ now, fromDate, toDate, config, busy, booked });
  return { ok: true, timeZone: config.timeZone, slots };
}

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

// The ordered steps are documented in the contract (section 5); numbers below match it.
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

  const now = d.now();
  const upcomingFilter = { userId, status: 'confirmed', startsAt: { $gt: now } };

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

  // 4. Fresh availability: ask the calendar again (no cache) and re-read confirmed bookings.
  const bufferMs = config.bufferMinutes * MINUTE;
  const rangeStart = new Date(start.getTime() - bufferMs);
  const rangeEnd = new Date(end.getTime() + bufferMs);
  let busy;
  try {
    busy = await d.calendar.getBusy({ start: rangeStart, end: rangeEnd }, { fresh: true });
  } catch {
    return { ok: false, code: 'calendar_unavailable' }; // nothing was written yet
  }
  const booked = await d.Booking.find({
    status: 'confirmed', startsAt: { $gte: new Date(rangeStart.getTime() - DAY), $lt: rangeEnd },
  }).lean();
  const stillFree = d.slots.computeSlots({ now, fromDate: localDate, toDate: localDate, config, busy, booked });
  if (!stillFree.some(s => s.startsAt === wanted)) return { ok: false, code: 'slot_taken' };

  // 5. Claim the slot. The unique index on startsAt (confirmed rows) makes this atomic:
  //    if two people get here together, the database rejects the second one.
  let booking;
  try {
    booking = await d.Booking.create({
      userId, startsAt: start, endsAt: end, status: 'confirmed', calendarEventId: null, note: cleanNote,
    });
  } catch (err) {
    if (isDuplicateStartsAt(err)) return { ok: false, code: 'slot_taken' };
    throw err;
  }

  // 6. Race guard: two requests of the SAME user may both pass step 2. Keep only one.
  if ((await d.Booking.countDocuments(upcomingFilter)) > 1) {
    await removeRow(d, booking._id, 'limit race');
    return { ok: false, code: 'limit_reached' };
  }

  // 7. Put the event in the clinic calendar. If that fails, give the slot back.
  const text = eventText(user, cleanNote, userId);
  let eventId;
  try {
    ({ eventId } = await d.calendar.createEvent({
      bookingId: booking._id, startsAt: start, endsAt: end, ...text,
    }));
  } catch {
    await removeRow(d, booking._id, 'calendar failure');
    return { ok: false, code: 'calendar_unavailable' };
  }

  // 8. Remember the event id. If we cannot, undo both the event and the row (best effort).
  try {
    await d.Booking.updateOne({ _id: booking._id }, {
      $set: { calendarEventId: eventId, calendarId: process.env.GOOGLE_CALENDAR_ID || '' },
    });
  } catch {
    try {
      await d.calendar.deleteEvent(eventId);
    } catch {
      console.error(`Booking ${booking._id}: calendar event cleanup failed`);
    }
    await removeRow(d, booking._id, 'event id save failure');
    return { ok: false, code: 'booking_failed' };
  }

  // 9. Soft warning (never a block) when the client has not done the skin analysis yet.
  const hasAnalysis = await d.SkinAnalysis.exists({ userId });
  return {
    ok: true,
    booking: publicBooking(booking, config.timeZone, d.slots),
    warning: hasAnalysis ? null : 'no_analysis',
  };
}

// ---------------------------------------------------------------------------------------------
// The signed-in client's own bookings
// ---------------------------------------------------------------------------------------------
async function listMine(userId, deps) {
  const d = withDefaults(deps);
  const now = d.now();
  const config = await getConfig(d);
  const [next] = await d.Booking.find({ userId, status: 'confirmed', startsAt: { $gt: now } })
    .sort({ startsAt: 1 }).limit(1).lean();
  const past = await d.Booking.find({ userId, status: 'confirmed', startsAt: { $lte: now } })
    .sort({ startsAt: -1 }).limit(20).lean();
  return {
    upcoming: next ? publicBooking(next, config.timeZone, d.slots) : null,
    past: past.map(b => publicBooking(b, config.timeZone, d.slots)),
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
    const pub = publicBooking(b, config.timeZone, d.slots);
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
    };
  });
}

// tab = upcoming | past | cancelled (anything else is treated as upcoming).
async function listForAdmin({ tab } = {}, deps) {
  const d = withDefaults(deps);
  const now = d.now();
  const queries = {
    upcoming: [{ status: 'confirmed', startsAt: { $gt: now } }, 1],
    past: [{ status: 'confirmed', startsAt: { $lte: now } }, -1],
    cancelled: [{ status: 'cancelled' }, -1],
  };
  const [filter, direction] = queries[tab] || queries.upcoming;
  const bookings = await d.Booking.find(filter).sort({ startsAt: direction }).lean();
  return toAdminRows(bookings, d);
}

// Every booking of one client, newest first (shown on the admin user page).
async function listForUser(userId, deps) {
  const d = withDefaults(deps);
  const bookings = await d.Booking.find({ userId }).sort({ startsAt: -1 }).lean();
  return toAdminRows(bookings, d);
}

// Cancel: the calendar event is deleted FIRST. If that fails the booking stays confirmed and
// the admin can simply retry (deleting an event twice is harmless).
async function cancelBooking(id, adminEmail, deps) {
  const d = withDefaults(deps);
  // Plain 24-hex check: mongoose's isValid would also accept any 12-character string.
  if (!/^[a-f\d]{24}$/i.test(String(id))) return { ok: false, code: 'not_found' };
  const booking = await d.Booking.findById(id).lean();
  if (!booking) return { ok: false, code: 'not_found' };
  if (booking.status === 'cancelled') return { ok: false, code: 'already_cancelled' };

  if (booking.calendarEventId) {
    try {
      await d.calendar.deleteEvent(booking.calendarEventId);
    } catch {
      return { ok: false, code: 'calendar_unavailable' };
    }
  }
  const changes = { status: 'cancelled', cancelledAt: d.now(), cancelledByAdminEmail: adminEmail };
  // The status filter makes a double click / two admins safe: only one of them matches.
  const result = await d.Booking.updateOne({ _id: id, status: 'confirmed' }, { $set: changes });
  if (result && result.matchedCount === 0) return { ok: false, code: 'already_cancelled' };
  return { ok: true, booking: { ...booking, ...changes } };
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
  const changed = ['enabled', 'slotMinutes', 'bufferMinutes', 'leadHours', 'horizonDays', 'weekly'].filter(name => (
    name === 'weekly' ? weeklyKey(current.weekly) !== weeklyKey(next.weekly) : current[name] !== next[name]
  ));
  if (changed.length) {
    await d.BookingConfig.updateOne({ key: 'main' }, { $set: next }, { upsert: true });
  }
  return { ok: true, changed };
}

// ---------------------------------------------------------------------------------------------
// Account deletion hook (contract section 13)
// ---------------------------------------------------------------------------------------------

// Removes the calendar events of the user's upcoming bookings. Best effort: a failure is logged
// (booking id only) and we carry on, because the account must always be deletable.
async function releaseUserBookings(userId, deps) {
  const d = withDefaults(deps);
  const upcoming = await d.Booking.find({
    userId, status: 'confirmed', startsAt: { $gt: d.now() },
  }).lean();
  for (const b of upcoming) {
    if (!b.calendarEventId) continue;
    try {
      await d.calendar.deleteEvent(b.calendarEventId);
    } catch {
      console.error(`Booking ${b._id}: calendar event could not be removed while deleting the account`);
    }
  }
}

module.exports = {
  isBookingEnabled, getConfig, getPublicConfig, listSlots, createBooking, listMine,
  listForAdmin, listForUser, cancelBooking, updateConfig, releaseUserBookings,
};
