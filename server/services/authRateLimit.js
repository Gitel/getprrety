const crypto = require('crypto');
const { consumeRateLimit, refundRateLimit } = require('./rateLimit');

// Per-IP throttle for the unauthenticated auth endpoints. Login and signup were
// completely unrestricted, leaving room for credential stuffing and — because signup
// runs bcrypt at cost 12 — cheap CPU/DB exhaustion. The IP is HMAC'd (never stored
// raw), mirroring the skin-scan endpoints.
function ipKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for auth rate limiting');
  return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex');
}

const RULES = {
  login:  { scope: 'auth_login',  limit: () => Number(process.env.AUTH_LOGIN_IP_15MIN_LIMIT || 15),  windowMs: 15 * 60 * 1000 },
  signup: { scope: 'auth_signup', limit: () => Number(process.env.AUTH_SIGNUP_IP_HOURLY_LIMIT || 30), windowMs: 60 * 60 * 1000 },
  google: { scope: 'auth_google', limit: () => Number(process.env.AUTH_GOOGLE_IP_15MIN_LIMIT || 30), windowMs: 15 * 60 * 1000 },
};

function ruleFor(kind) {
  const rule = RULES[kind];
  if (!rule) throw new Error(`Unknown auth rate-limit kind: ${kind}`);
  return rule;
}

// Returns true when the request is allowed, false when the IP is over its limit.
// Consumed before the endpoint does any work, so an attacker can't force bcrypt to
// run before being told no.
async function allowAuthAttempt(req, kind) {
  const rule = ruleFor(kind);
  return consumeRateLimit(rule.scope, ipKey(req), rule.limit(), rule.windowMs);
}

// Called once an attempt has actually succeeded. The budget is meant to cap failed
// attempts and CPU burn, not real signups and logins — see refundRateLimit.
async function releaseAuthAttempt(req, kind) {
  const rule = ruleFor(kind);
  await refundRateLimit(rule.scope, ipKey(req), rule.windowMs);
}

module.exports = { allowAuthAttempt, releaseAuthAttempt };
