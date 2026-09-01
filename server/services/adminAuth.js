const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client();

const COOKIE_NAME = 'gp_admin';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Who may sign into /admin. Comma-separated env override; defaults match the spec.
function allowedEmails() {
  const raw = process.env.ADMIN_ALLOWED_EMAILS || 'dzaturansky@gmail.com,lutreat@gmail.com';
  return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function isAllowed(email) {
  return typeof email === 'string' && allowedEmails().includes(email.trim().toLowerCase());
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
function verifySession(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, sessionSecret());
    if (payload.scope !== 'admin' || !isAllowed(payload.email)) return null;
    return payload;
  } catch {
    return null;
  }
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

function requireAdmin(req, res, next) {
  const session = verifySession(req.cookies && req.cookies[COOKIE_NAME]);
  if (!session) return res.redirect('/admin/login');
  req.admin = session;
  next();
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  allowedEmails,
  isAllowed,
  verifyGoogleCredential,
  signSession,
  verifySession,
  cookieOptions,
  requireAdmin,
};
