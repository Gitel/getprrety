const mongoose = require('mongoose');

// A consultation bought DIRECTLY in the clinic's Shopify store (not through the app's booking
// screen, so the order has no `getpretty_booking` attribute). After paying, the customer picks a
// time on the clinic's Google appointment page, so the time lives only in Google Calendar.
//
// The Shopify webhook (routes/payments.js) stores one row per order. A background sweep
// (services/shopifyConsultations.js matchAppointments) then looks in the clinic calendar for an
// event that has the order's email as an attendee and copies its time into `appointment`.
// There is no userId: the row is linked to an app account by EMAIL when it is read, so an order
// paid before the customer signed up is found as soon as they sign up with the same email.
//
// Only what the feature needs is stored: no names, addresses, notes or the raw order payload.
const appointmentSchema = new mongoose.Schema({
  eventId:   { type: String, required: true }, // Google Calendar event id
  startsAt:  { type: Date, required: true },
  endsAt:    { type: Date, required: true },
  matchedAt: { type: Date, required: true },   // when the sweep last confirmed this event
}, { _id: false });

const shopifyConsultationOrderSchema = new mongoose.Schema({
  // Shopify's numeric order id, kept as a string. Unique: a re-delivered webhook is a no-op.
  orderId:   { type: String, required: true, unique: true },
  // The order number the clinic sees in Shopify, e.g. "#1042" (shown on the admin user page).
  orderName: { type: String, default: '' },
  email:     { type: String, required: true, lowercase: true, trim: true },
  paidAt:    { type: Date, required: true },
  amount:    { type: Number, default: null },
  currency:  { type: String, default: null },
  // null until the sweep finds the customer's event in the clinic calendar.
  appointment: { type: appointmentSchema, default: null },
  // When the sweep last looked (null = never). The sweep checks the oldest-checked rows first.
  lastCheckedAt: { type: Date, default: null },
}, { timestamps: true });

// "Orders of this customer", newest first (app + admin user page).
shopifyConsultationOrderSchema.index({ email: 1, paidAt: -1 });
// The sweep: recent orders, least recently checked first.
shopifyConsultationOrderSchema.index({ paidAt: 1, lastCheckedAt: 1 });

module.exports = mongoose.model('ShopifyConsultationOrder', shopifyConsultationOrderSchema);
