// Consultations bought DIRECTLY in the clinic's Shopify store (see models/ShopifyConsultationOrder.js).
// Plan: AI/plans/shopify-consultation-link.md.
//
// Like services/bookingPayments.js, every function takes `deps` as its LAST argument so tests can
// pass fakes (model, calendar, clock). Logs carry order ids and codes only - never emails.
const ShopifyConsultationOrder = require('../models/ShopifyConsultationOrder');
const realCalendar = require('./calendar');
const slots = require('./slots'); // clinic-local date/time helpers (pure, no I/O)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 24 * 60 * 60 * 1000;
const OPEN_DAYS = 60;      // orders paid in the last 60 days are checked by the sweep and shown
const LOOKAHEAD_DAYS = 60; // the appointment is searched up to 60 days after the payment
const SWEEP_BATCH = 50;    // most orders one sweep checks (one calendar call each)
const CLINIC_TZ = 'Asia/Jerusalem'; // the clinic's time zone (also the fixed booking time zone)

// Fills in the real dependencies; a test passes only the ones it wants to fake.
function withDefaults(deps = {}) {
  return { Order: ShopifyConsultationOrder, calendar: realCalendar, now: () => new Date(), ...deps };
}

// A date Shopify sent (e.g. order.processed_at), or null when it is missing / not a date.
function dateOrNull(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/**
 * Store a paid Shopify consultation order (called by the orders/paid webhook).
 * Safe to call many times for the same order: the first call inserts, later ones change nothing.
 * @param {object} order the Shopify order JSON (only id, name, email, processed_at, total_price
 *                       and currency are read)
 * @returns {{ ok: true, result: 'shopify_consultation_recorded' | 'already_recorded' | 'no_email' }}
 */
async function recordOrder(order, deps) {
  const d = withDefaults(deps);
  // The email links the order to an app account. Without one there is nothing we can do with
  // the order (e.g. a phone order typed in by staff), so it is acknowledged and not stored.
  const email = typeof order.email === 'string' ? order.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: true, result: 'no_email' };

  const orderId = String(order.id);
  const amount = Number(order.total_price);
  try {
    // $setOnInsert = only written when the row is created, so a re-delivery never overwrites it.
    const res = await d.Order.updateOne(
      { orderId },
      {
        $setOnInsert: {
          orderId,
          orderName: typeof order.name === 'string' ? order.name.slice(0, 40) : '',
          email,
          // When Shopify processed the payment; our clock if Shopify did not say.
          paidAt: dateOrNull(order.processed_at) || d.now(),
          amount: Number.isFinite(amount) ? amount : null,
          currency: typeof order.currency === 'string' ? order.currency.slice(0, 8) : null,
        },
      },
      { upsert: true }
    );
    return { ok: true, result: res && res.upsertedCount ? 'shopify_consultation_recorded' : 'already_recorded' };
  } catch (err) {
    // Two deliveries of the same order raced and the other one inserted first (unique orderId).
    if (err && err.code === 11000) return { ok: true, result: 'already_recorded' };
    throw err;
  }
}

/**
 * The sweep (server/index.js runs it every 5 minutes when the calendar is configured).
 * For each open order - paid in the last OPEN_DAYS days and either not matched yet or matched to
 * an appointment that has not ended - look in the clinic calendar for the customer's event
 * (attendee = the order email, made by the appointment page) and store its time.
 * Matched orders are re-checked until the appointment ends, so a rescheduled appointment gets
 * the new time and a cancelled one goes back to "not matched".
 * One failing order is logged and skipped; it never stops the others.
 * @returns {{ checked, matched, failed }}
 */
async function matchAppointments(deps) {
  const d = withDefaults(deps);
  const now = d.now();
  const orders = await d.Order.find({
    paidAt: { $gt: new Date(now.getTime() - OPEN_DAYS * DAY) },
    $or: [{ appointment: null }, { 'appointment.endsAt': { $gt: now } }],
  }).sort({ lastCheckedAt: 1 }).limit(SWEEP_BATCH).lean(); // never-checked (null) rows come first

  let matched = 0;
  let failed = 0;
  for (const o of orders) {
    try {
      const paidAt = new Date(o.paidAt);
      const events = await d.calendar.findAttendeeEvents({
        email: o.email, timeMin: paidAt, timeMax: new Date(paidAt.getTime() + LOOKAHEAD_DAYS * DAY),
      });
      // A customer who bought two consultations has two orders: each order takes its OWN event,
      // so skip events another order already holds. Events come sorted, so the earliest free one wins.
      const others = events.length
        ? await d.Order.find({ orderId: { $ne: o.orderId }, 'appointment.eventId': { $in: events.map(e => e.eventId) } })
          .select('appointment.eventId').lean()
        : [];
      const taken = new Set(others.map(x => x.appointment.eventId));
      const ev = events.find(e => !taken.has(e.eventId)) || null;
      const appointment = ev ? { eventId: ev.eventId, startsAt: ev.startsAt, endsAt: ev.endsAt, matchedAt: now } : null;
      await d.Order.updateOne({ orderId: o.orderId }, { $set: { appointment, lastCheckedAt: now } });
      if (ev) matched += 1;
    } catch (err) {
      failed += 1;
      console.error(`shopifyConsultations: appointment check failed for order ${o.orderId} (${(err && (err.code || err.name)) || 'error'})`);
      // Still mark it checked, so one broken row moves to the back of the queue instead of
      // being retried first on every sweep. (Best effort: a failure here is ignored.)
      await d.Order.updateOne({ orderId: o.orderId }, { $set: { lastCheckedAt: now } }).catch(() => {});
    }
  }
  return { checked: orders.length, matched, failed };
}

/**
 * The Shopify consultation to show for a customer (app Booking screen, Profile button rule), or null:
 * the order with the earliest appointment that has not ended; otherwise the newest order that has
 * no appointment yet. Only orders paid in the last OPEN_DAYS days count; an order whose
 * appointment already ended is not returned.
 */
async function activeForEmail(email, deps) {
  const d = withDefaults(deps);
  if (!email) return null;
  const now = d.now();
  const orders = await d.Order.find({
    email: String(email).toLowerCase(), paidAt: { $gt: new Date(now.getTime() - OPEN_DAYS * DAY) },
  }).sort({ paidAt: -1 }).limit(20).lean();
  const upcoming = orders
    .filter(o => o.appointment && new Date(o.appointment.endsAt) > now)
    .sort((a, b) => new Date(a.appointment.startsAt) - new Date(b.appointment.startsAt))[0];
  return upcoming || orders.find(o => !o.appointment) || null;
}

// Every order of a customer, newest first (admin user page). Capped: the page shows a short list.
async function listForEmail(email, deps) {
  const d = withDefaults(deps);
  if (!email) return [];
  return d.Order.find({ email: String(email).toLowerCase() }).sort({ paidAt: -1 }).limit(10).lean();
}

// "2026-10-20 10:00" in clinic time (the same clock as the admin Bookings pages).
function clinicStamp(date) {
  const { date: day, time } = slots.localParts(new Date(date), CLINIC_TZ);
  return `${day} ${time}`;
}

// One line of the admin user page's "Shopify consultations" card (views/admin/user.ejs).
function toAdminRow(o) {
  return {
    orderId: o.orderId,
    orderName: o.orderName || '',
    paidAt: clinicStamp(o.paidAt),
    amount: o.amount,
    currency: o.currency || '',
    appointment: o.appointment ? clinicStamp(o.appointment.startsAt) : null, // null = not found yet
  };
}

// Deleting a customer's account also deletes their Shopify consultation orders (plan D6).
async function deleteForEmail(email, deps) {
  const d = withDefaults(deps);
  if (!email) return;
  await d.Order.deleteMany({ email: String(email).toLowerCase() });
}

module.exports = { recordOrder, matchAppointments, activeForEmail, listForEmail, toAdminRow, deleteForEmail, OPEN_DAYS };
