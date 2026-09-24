const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const AdminUser = require('../models/AdminUser');

const googleClient = new OAuth2Client();

const COOKIE_NAME = 'gp_admin';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Built-in admins. Comma-separated env override; defaults match the spec.
// These always have access and cannot be removed from the dashboard (see isBuiltInAdmin).
function allowedEmails() {
  const raw = process.env.ADMIN_ALLOWED_EMAILS || 'dzaturansky@gmail.com,lutreat@gmail.com';
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// True only for the env-configured admins. The Admins page uses this to mark them as
// protected, and the remove route refuses them.
function isBuiltInAdmin(email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized) && allowedEmails().includes(normalized);
}

// Who may sign into /admin: a built-in admin OR an admin added from the dashboard
// (stored in the AdminUser collection). Async because the second check hits MongoDB.
// A database error is thrown, not swallowed as "not allowed", so a Mongo outage shows
// up as a 500 instead of silently logging every admin out.
async function isAllowed(email) {
  if (isBuiltInAdmin(email)) return true;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return Boolean(await AdminUser.exists({ email: normalized }));
}

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET / JWT_SECRET is not configured');
  return secret;
}

// Verify a Google-issued ID token (the `credential` from Google Identity Services).
async function verifyGoogleCredential(credential) {
  const audience = (process.env.GOOGLE_CLIENT_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!audience.length) throw new Error('GOOGLE_CLIENT_IDS is not configured');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience });
  return ticket.getPayload();
}

function signSession(email) {
  return jwt.sign({ email: String(email).toLowerCase(), scope: 'admin' }, sessionSecret(), {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

// Returns the decoded session, or null if invalid / not (or no longer) allow-listed.
// The allow-list is re-checked on every request, so removing an admin (from the env list
// or from the dashboard) revokes their access immediately, not after the 7-day cookie.
async function verifySession(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, sessionSecret());
  } catch {
    return null; // bad signature, expired, or no secret configured
  }
  if (payload.scope !== 'admin') return null;
  if (!(await isAllowed(payload.email))) return null;
  return payload;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/admin',
  };
}

// Express middleware guarding every dashboard page. Async because verifySession may query
// MongoDB; a database error goes to the global error handler via next(err) instead of
// becoming an unhandled promise rejection. next() is called outside the try on purpose,
// so an error thrown later in the chain is never reported twice.
async function requireAdmin(req, res, next) {
  let session;
  try {
    session = await verifySession(req.cookies && req.cookies[COOKIE_NAME]);
  } catch (err) {
    return next(err);
  }
  if (!session) return res.redirect('/admin/login');
  req.admin = session;
  next();
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  allowedEmails,
  normalizeEmail,
  isBuiltInAdmin,
  isAllowed,
  verifyGoogleCredential,
  signSession,
  verifySession,
  cookieOptions,
  requireAdmin,
};
