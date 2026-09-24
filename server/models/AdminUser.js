const mongoose = require('mongoose');

// Admins added from the /admin dashboard. These are IN ADDITION to the built-in admins
// in the ADMIN_ALLOWED_EMAILS env var (services/adminAuth.js), which always have access
// and are never stored here — so nobody can lock the clinic out by deleting rows.
// An email listed here may sign into /admin with Google exactly like a built-in admin.
const adminUserSchema = new mongoose.Schema({
  // Stored normalized (trimmed + lowercase) so the lookup in isAllowed() is exact.
  email:   { type: String, required: true, unique: true, lowercase: true, trim: true },
  // Which admin granted access — shown on the Admins page for accountability.
  addedBy: { type: String, required: true, lowercase: true, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('AdminUser', adminUserSchema);
