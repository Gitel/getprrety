const mongoose = require('mongoose');
const AdminUser = require('../models/AdminUser');
const { normalizeEmail, isBuiltInAdmin } = require('./adminAuth');

// Same shape check the app's signup uses (routes/auth.js). Google sign-in is what really
// proves ownership of the address; this only stops typos like "name@gmail".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Grant dashboard access to an email.
 * Returns { ok: true, email } or { ok: false, code } where code is one of:
 *   'invalid'  - not an email address
 *   'builtin'  - already a built-in (env) admin, nothing to add
 *   'exists'   - already added from the dashboard
 */
async function addAdmin({ email, addedBy }, { model = AdminUser } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254 || !EMAIL_RE.test(normalized)) return { ok: false, code: 'invalid' };
  if (isBuiltInAdmin(normalized)) return { ok: false, code: 'builtin' };
  try {
    await model.create({ email: normalized, addedBy: normalizeEmail(addedBy) });
  } catch (err) {
    // The unique index on email is the real guard against a double add (two admins
    // clicking at once), so a duplicate-key error means "already there", not a failure.
    if (err && err.code === 11000) return { ok: false, code: 'exists' };
    throw err;
  }
  return { ok: true, email: normalized };
}

/**
 * Revoke dashboard access for a dashboard-added admin.
 * Built-in admins are never stored in AdminUser, so they cannot be reached from here:
 * that is what keeps them protected.
 * Returns { ok: true, email } or { ok: false, code } where code is one of:
 *   'notfound' - no such dashboard admin
 *   'self'     - an admin may not remove themself (avoids an accidental lockout)
 */
async function removeAdmin({ id, actingEmail }, { model = AdminUser } = {}) {
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'notfound' };
  const doc = await model.findById(id).lean();
  if (!doc) return { ok: false, code: 'notfound' };
  if (doc.email === normalizeEmail(actingEmail)) return { ok: false, code: 'self' };
  await model.deleteOne({ _id: doc._id });
  return { ok: true, email: doc.email };
}

module.exports = { addAdmin, removeAdmin };
