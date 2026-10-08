const mongoose = require('mongoose');

// Every state-changing action an admin can take from /admin. Kept in one list so the
// enum, the helper and the enum-guard test (AdminAuditLog.test.js) cannot drift apart.
const ACTIONS = [
  'admin_added',             // Admins page: granted dashboard access
  'admin_removed',           // Admins page: revoked dashboard access
  'clinic_email_resent',     // Customer page: "Resend to clinic"
  'user_profile_updated',    // User page: name / email / timing / city / country
  'analysis_fields_updated', // Customer page: era / analysis text / insights / affirmation
  'routine_updated',         // Customer page: AM/PM routine steps
  'product_audit_updated',   // Customer page: keep / remove / replace / add buckets
  'product_picks_updated',   // Customer page: brand / name / price / link picks
  'sr_ritual_updated',       // Customer page: SR Ritual products
  'shelf_updated',           // Customer page: shelf analysis
  'message_sent',            // User page: message to the user
  'user_deleted',            // User page: account and all data deleted
  'catalogue_product_created',  // Products page: new product added
  'catalogue_product_updated',  // Products page: text / category / use / pregnancy fields edited
  'catalogue_photo_replaced',   // Products page: product photo uploaded
  'catalogue_product_archived', // Products page: product hidden from the catalogue
  'catalogue_product_restored', // Products page: archived product brought back
  'booking_cancelled',          // Bookings page: admin cancelled a booking
  'booking_settings_updated',   // Booking settings page: hours / slot rules changed
];

// Who changed what, and when. Records the NAMES of changed fields, never their values:
// the values are health data and the log must not become a second copy of it.
// A user_deleted entry keeps only the (now dangling) userId, never the email.
const adminAuditLogSchema = new mongoose.Schema({
  adminEmail:       { type: String, required: true, lowercase: true, trim: true },
  action:           { type: String, enum: ACTIONS, required: true },
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  analysisId:       { type: mongoose.Schema.Types.ObjectId, ref: 'SkinAnalysis', default: null },
  // Only for the catalogue_* actions: which product was touched.
  catalogueProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogueProduct', default: null },
  // Only for admin_added / admin_removed: which admin account was granted or revoked.
  // Only for booking_cancelled: which booking was cancelled (userId is set too).
  bookingId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  targetAdminEmail: { type: String, lowercase: true, trim: true, default: null },
  fields:           { type: [String], default: [] },
}, { timestamps: true });

// The Audit page lists newest first, optionally filtered to one user.
adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ userId: 1, createdAt: -1 });

const AdminAuditLog = mongoose.model('AdminAuditLog', adminAuditLogSchema);
AdminAuditLog.ACTIONS = ACTIONS;

module.exports = AdminAuditLog;
