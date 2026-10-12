// What happens AFTER the customer pays in Shopify: turn the held slot into a confirmed booking
// and, separately, write the Google Calendar event. Everything that touches the outside world
// (database model, calendar, clock) is passed in as the LAST argument `deps`, so tests use fakes.
//
// Logs carry booking ids, order ids and codes only - never emails, names, notes or payloads.
const Booking = require('../models/Booking');
const User = require('../models/User');
const realCalendar = require('./calendar');
const bookings = require('./bookings');
const { isDuplicateStartsAt } = require('./duplicateKey');

const CLAIM_MS = 60 * 1000;   // a calendar claim older than this may be taken over (writer crashed)
const SYNC_BATCH = 50;        // most rows one sweep tries, so a backlog cannot stall the server
const MAX_ATTEMPTS = 3;       // re-reads when a conditional update loses a race

function withDefaults(deps = {}) {
  return { Booking, User, calendar: realCalendar, now: () => new Date(), ...deps };
}

// Plain 24-hex check (mongoose's isValid would also accept any 12-character string).
const isObjectId = id => /^[a-f\d]{24}$/i.test(String(id));

// The "paid" payment block stored on the booking.
const paidBlock = (d, { orderId, amount, currency }) => ({
  status: 'paid', amount, currency, providerRef: orderId, paidAt: d.now(),
});

// ---------------------------------------------------------------------------------------------
// recordPayment
// ---------------------------------------------------------------------------------------------

// Called for every verified "order paid" webhook. Safe to call many times for the same order.
// Every state change is ONE findOneAndUpdate filtered on the status we just read, so when two
// deliveries race only one of them matches; the loser re-reads and sees the winner's result.
async function recordPayment({ bookingId, orderId, amount, currency } = {}, deps) {
  const d = withDefaults(deps);
  if (!isObjectId(bookingId)) return { ok: true, result: 'booking_not_found' };
  const order = { orderId: String(orderId), amount, currency };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const b = await d.Booking.findById(bookingId).lean();
    if (!b) return { ok: true, result: 'booking_not_found' };

    const paidWith = b.payment && b.payment.providerRef;
    const extras = (b.payment && b.payment.extraRefs) || [];
    // This exact order was already recorded (as the main payment or as an extra): nothing to do.
    if (paidWith === order.orderId || extras.includes(order.orderId)) return { ok: true, result: 'already_recorded' };

    // The row is already paid or flagged and a NEW order arrived (the customer paid twice): keep the
    // first payment, remember the extra order id (so its re-delivery is "already_recorded") and flag
    // the row for a human (refund). This path never throws, so Shopify does not retry for hours.
    if (paidWith || b.needsAttention) {
      // A new payment always (re)opens the row in Needs attention: clearing "handled" makes a row the
      // admin already dealt with come back, because this extra money needs a refund too.
      const update = {
        $addToSet: { 'payment.extraRefs': order.orderId },
        $set: { attentionHandledAt: null, attentionHandledByAdminEmail: null },
      };
      if (!b.needsAttention) update.$set.needsAttention = 'paid_extra';
      const row = await d.Booking.findOneAndUpdate(
        // Conditional on the flag we read and on the order not being stored yet (race guard).
        { _id: b._id, needsAttention: b.needsAttention || null, 'payment.extraRefs': { $ne: order.orderId } },
        update, { new: true },
      ).lean();
      if (row) {
        console.error(`payments: booking ${b._id} got an extra payment, order ${order.orderId} (paid_extra)`);
        return { ok: true, result: 'needs_attention', needsAttention: row.needsAttention || 'paid_extra' };
      }
      continue; // lost a race: re-read (the next pass sees the winner's write)
    }

    // The customer paid after the booking was cancelled: record the money, keep the row cancelled.
    if (b.status === 'cancelled') {
      const row = await d.Booking.findOneAndUpdate(
        { _id: b._id, status: 'cancelled' },
        { $set: { payment: paidBlock(d, order), needsAttention: 'paid_after_cancel' } }, { new: true },
      ).lean();
      if (row) {
        console.error(`payments: booking ${b._id} paid after cancel, order ${order.orderId}`);
        return { ok: true, result: 'needs_attention', needsAttention: 'paid_after_cancel' };
      }
      continue;
    }

    // A confirmed row that was never paid (should not happen for new bookings): just record payment.
    if (b.status === 'confirmed') {
      const row = await d.Booking.findOneAndUpdate(
        { _id: b._id, status: 'confirmed', 'payment.providerRef': null },
        { $set: { payment: paidBlock(d, order) } }, { new: true },
      ).lean();
      if (row) return { ok: true, result: 'confirmed' };
      continue;
    }

    // From here the row is pending_payment or expired (a late payment may still win the slot).
    const expected = b.status;

    // The payment arrived when the appointment time has already started or passed: do not confirm a
    // booking in the past. Record the money, keep the row expired and flag it for a human.
    if (new Date(b.startsAt).getTime() <= d.now().getTime()) {
      const row = await d.Booking.findOneAndUpdate(
        { _id: b._id, status: expected },
        { $set: { status: 'expired', holdExpiresAt: null, payment: paidBlock(d, order), needsAttention: 'paid_slot_lost' } },
        { new: true },
      ).lean();
      if (row) {
        console.error(`payments: booking ${b._id} paid after its start time, order ${order.orderId} (paid_slot_lost)`);
        return { ok: true, result: 'needs_attention', needsAttention: 'paid_slot_lost' };
      }
      continue;
    }

    // The user already holds another confirmed upcoming booking: do not give them a second one.
    const hasOther = await d.Booking.exists({
      userId: b.userId, status: 'confirmed', startsAt: { $gt: d.now() }, _id: { $ne: b._id },
    });
    if (hasOther) {
      const row = await d.Booking.findOneAndUpdate(
        { _id: b._id, status: expected },
        { $set: { status: 'expired', holdExpiresAt: null, payment: paidBlock(d, order), needsAttention: 'paid_extra' } },
        { new: true },
      ).lean();
      if (row) {
        console.error(`payments: booking ${b._id} paid but the user already has another booking, order ${order.orderId}`);
        return { ok: true, result: 'needs_attention', needsAttention: 'paid_extra' };
      }
      continue;
    }

    try {
      const row = await d.Booking.findOneAndUpdate(
        { _id: b._id, status: expected },
        { $set: { status: 'confirmed', holdExpiresAt: null, payment: paidBlock(d, order) } },
        { new: true },
      ).lean();
      if (!row) continue; // lost a race: re-read
      await expireOtherHolds(d, b);
      return { ok: true, result: 'confirmed' };
    } catch (err) {
      if (!isDuplicateStartsAt(err)) throw err;
      // Someone else confirmed this start time first, so the unique index refused ours.
      const row = await d.Booking.findOneAndUpdate(
        { _id: b._id, status: expected },
        { $set: { status: 'expired', holdExpiresAt: null, payment: paidBlock(d, order), needsAttention: 'paid_slot_lost' } },
        { new: true },
      ).lean();
      if (row) {
        console.error(`payments: booking ${b._id} paid but the slot was taken, order ${order.orderId} (paid_slot_lost)`);
        return { ok: true, result: 'needs_attention', needsAttention: 'paid_slot_lost' };
      }
    }
  }
  // Could not settle after several re-reads: fail so Shopify retries the delivery later.
  throw new Error(`recordPayment could not settle booking ${bookingId}`);
}

// After a confirmation: the same user's other holds and any other user's hold on the same start
// are released (the paid booking wins the slot; the other customer sees "time ran out").
async function expireOtherHolds(d, b) {
  try {
    await d.Booking.updateMany(
      { _id: { $ne: b._id }, userId: b.userId, status: 'pending_payment' },
      { $set: { status: 'expired' } },
    );
    await d.Booking.updateMany(
      { _id: { $ne: b._id }, userId: { $ne: b.userId }, startsAt: b.startsAt, status: 'pending_payment' },
      { $set: { status: 'expired' } },
    );
  } catch (err) {
    // The payment is already safe; stale holds also expire by themselves after 15 minutes.
    console.error(`payments: booking ${b._id} confirmed but releasing other holds failed (${err && err.name})`);
  }
}

// ---------------------------------------------------------------------------------------------
// syncCalendarEvents
// ---------------------------------------------------------------------------------------------

// Writes the Google Calendar event of confirmed, upcoming bookings that have none yet. Runs after
// each paid webhook and from the 60 s sweep. Never throws; a failed row is retried next run.
async function syncCalendarEvents(deps) {
  const d = withDefaults(deps);
  let rows;
  try {
    rows = await d.Booking.find({
      status: 'confirmed', startsAt: { $gt: d.now() }, calendarEventId: null,
    }).limit(SYNC_BATCH).lean();
  } catch (err) {
    console.error(`payments: calendar sync could not list bookings (${err && err.name})`);
    return;
  }
  for (const row of rows) {
    try {
      await syncOne(d, row);
    } catch (err) {
      // Ids and Google's reason only: the error object can hold request or user data.
      console.error(`payments: calendar event for booking ${row._id} failed ${realCalendar.describeCalendarError(err)} (${err && err.name}); will retry`);
    }
  }
}

async function syncOne(d, row) {
  const now = d.now();
  // Claim: only one writer wins. A claim older than 60 s is treated as abandoned (writer crashed).
  const claimed = await d.Booking.findOneAndUpdate(
    {
      _id: row._id, status: 'confirmed', calendarEventId: null,
      $or: [{ calendarClaimedAt: null }, { calendarClaimedAt: { $lt: new Date(now.getTime() - CLAIM_MS) } }],
    },
    { $set: { calendarClaimedAt: now } }, { new: true },
  ).lean();
  if (!claimed) return; // another writer has it, or it is no longer eligible

  const user = await d.User.findById(claimed.userId).select('email firstName').lean();
  if (!user) {
    console.error(`payments: booking ${claimed._id} has no user, calendar event skipped`);
    return;
  }
  const text = bookings.eventText(user, claimed.note, claimed.userId);
  const pay = claimed.payment || {};
  const description = `${text.description}\nPaid: ${pay.amount} ${pay.currency} (Shopify order ${pay.providerRef})`;

  const { eventId } = await d.calendar.createEvent({
    bookingId: claimed._id,
    // Our booking id doubles as the Google event id: a retry after a timeout cannot create a second event.
    eventId: String(claimed._id), startsAt: claimed.startsAt, endsAt: claimed.endsAt, summary: text.summary, description,
  });

  const saved = await d.Booking.findOneAndUpdate(
    { _id: claimed._id, status: 'confirmed' },
    { $set: { calendarEventId: eventId, calendarId: process.env.GOOGLE_CALENDAR_ID || '' } }, { new: true },
  ).lean();
  if (!saved) {
    // Cancelled while we were talking to Google: do not leave an orphan event behind.
    try {
      await d.calendar.deleteEvent(eventId);
    } catch (err) {
      console.error(`payments: booking ${claimed._id} orphan calendar event ${eventId} cleanup failed ${realCalendar.describeCalendarError(err)}`);
    }
  }
}

module.exports = { recordPayment, syncCalendarEvents };
