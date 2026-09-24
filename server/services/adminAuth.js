const crypto = require('crypto');
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

// The session carries a random per-login `csrf` value. Every dashboard form echoes it back
// (hidden _csrf field or X-CSRF-Token header) and requireCsrf compares the two. Another
// site can make the browser send our cookie, but it cannot read the page, so it can
// never know this value. That makes a forged POST from elsewhere fail.
function signSession(email) {
  const csrf = crypto.randomBytes(24).toString('base64url');
  return jwt.sign({ email: String(email).toLowerCase(), scope: 'admin', csrf }, sessionSecret(), {
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
  // Sessions issued before the CSRF claim existed have no `csrf`; treat them as logged
  // out so every live session can protect its forms. Costs each admin one re-login.
  if (typeof payload.csrf !== 'string' || !payload.csrf) return null;
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
  // Exposed to every EJS view (and its includes) so forms can embed the token as a
  // hidden `_csrf` input without each route passing it by hand.
  if (res.locals) res.locals.csrfToken = session.csrf;
  next();
}

// Guards every state-changing dashboard route. It must run AFTER requireAdmin (it reads
// req.admin.csrf), which is why routes wire it explicitly instead of router-wide: the
// Google sign-in POST has no session yet and must not be checked.
// Accepts the token from a urlencoded form body (`_csrf`) or, for the JSON editors,
// from the X-CSRF-Token header. Compared in constant time.
function requireCsrf(req, res, next) {
  const expected = req.admin && req.admin.csrf;
  const sent = (req.body && typeof req.body._csrf === 'string' && req.body._csrf)
    || (req.headers && req.headers['x-csrf-token'])
    || '';
  const ok = typeof expected === 'string'
    && typeof sent === 'string'
    && sent.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return res.status(403).send('This form has expired. Go back, reload the page and try again.');
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
  requireCsrf,
};
