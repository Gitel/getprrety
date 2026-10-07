const mongoose = require('mongoose');

// One in-app appointment between a user and the clinic. The matching Google Calendar
// event id is stored so an admin cancel can remove the event again.
const bookingSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Slot start / end, always stored in UTC. Display conversion uses the config time zone.
  startsAt:   { type: Date, required: true },
  endsAt:     { type: Date, required: true },
  status:     { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  // null only for the short moment between saving the row and creating the calendar event.
  calendarEventId: { type: String, default: null },
  // Snapshot of GOOGLE_CALENDAR_ID at booking time ('' in mock mode).
  calendarId: { type: String, default: '' },
  note:       { type: String, trim: true, maxlength: 300, default: '' },
  cancelledAt: { type: Date, default: null },
  cancelledByAdminEmail: { type: String, lowercase: true, trim: true, default: null },
  // Reserved seam for a future payment provider. No behaviour uses it yet.
  payment: {
    type: {
      status:      { type: String, default: 'none' },
      amount:      { type: Number, default: null },
      currency:    { type: String, default: null },
      providerRef: { type: String, default: null },
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

const Booking = mongoose.model('Booking', bookingSchema);
Booking.STATUSES = ['confirmed', 'cancelled'];
Booking.NOTE_MAX = 300;

module.exports = Booking;
