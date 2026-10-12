const mongoose = require('mongoose');

// One in-app appointment between a user and the clinic. The matching Google Calendar
// event id is stored so an admin cancel can remove the event again.
const bookingSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Slot start / end, always stored in UTC. Display conversion uses the config time zone.
  startsAt:   { type: Date, required: true },
  endsAt:     { type: Date, required: true },
  // pending_payment = slot held while the customer pays; confirmed = paid (or an old row);
  // expired = the hold ran out unpaid; cancelled = cancelled by the user or an admin.
  // The default stays 'confirmed' so old rows keep their meaning; new rows set 'pending_payment'.
  status:     { type: String, enum: ['pending_payment', 'confirmed', 'expired', 'cancelled'], default: 'confirmed' },
  // Only set on pending_payment rows: when the unpaid hold stops blocking the slot.
  holdExpiresAt: { type: Date, default: null },
  // Set when money and slot disagree and a human has to look (shown in the admin bookings page).
  needsAttention: { type: String, enum: [null, 'paid_slot_lost', 'paid_after_cancel', 'paid_extra'], default: null },
  // Claim for the single writer that creates the calendar event (stops two writers doing it twice).
  calendarClaimedAt: { type: Date, default: null },
  // null only for the short moment between saving the row and creating the calendar event.
  calendarEventId: { type: String, default: null },
  // Snapshot of GOOGLE_CALENDAR_ID at booking time ('' in mock mode).
  calendarId: { type: String, default: '' },
  note:       { type: String, trim: true, maxlength: 300, default: '' },
  cancelledAt: { type: Date, default: null },
  cancelledByAdminEmail: { type: String, lowercase: true, trim: true, default: null },
  // Payment state. 'awaiting' on a new hold, 'paid' once Shopify confirms, 'none' on old rows.
  payment: {
    type: {
      status:      { type: String, enum: ['none', 'awaiting', 'paid'], default: 'none' },
      amount:      { type: Number, default: null },
      currency:    { type: String, default: null },
      providerRef: { type: String, default: null }, // Shopify order id as a string
      paidAt:      { type: Date, default: null },
    },
    default: () => ({}),
    _id: false,
  },
}, { timestamps: true });

// "My bookings", newest first.
bookingSchema.index({ userId: 1, startsAt: -1 });
// THE DOUBLE-BOOKING GUARD. Two confirmed bookings can never share a start time because
// the database itself rejects the second insert (E11000). It is partial so that a
// cancelled booking does not block the slot: the slot becomes bookable again.
// Known limit (accepted for phase 1): it only guards an IDENTICAL startsAt. With a buffer or right after
// a slot-length change, two simultaneous requests for different but overlapping starts can both succeed.
bookingSchema.index({ startsAt: 1 }, { unique: true, partialFilterExpression: { status: 'confirmed' } });

// Same guard for held (unpaid) slots: two pending_payment holds can never share a start time.
// Added next to the confirmed one above, which is unchanged.
bookingSchema.index({ startsAt: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'pending_payment' }, name: 'startsAt_pending_unique' });

const Booking = mongoose.model('Booking', bookingSchema);
Booking.STATUSES = ['pending_payment', 'confirmed', 'expired', 'cancelled'];
Booking.NEEDS_ATTENTION = ['paid_slot_lost', 'paid_after_cancel', 'paid_extra'];
Booking.NOTE_MAX = 300;

module.exports = Booking;
