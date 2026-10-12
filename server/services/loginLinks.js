// One-time sign-in links and invites, created by an admin (see models/LoginLink.js).
//
// Security model: the raw token is 32 random bytes. Lookup uses only its SHA-256 hash; an
// AES-256-GCM encrypted copy is stored so the admin page can show the same link again.
// Like services/bookings.js, every function takes `deps` as its LAST argument so tests can
// pass fakes. Never log tokens, links, emails or names - ids and codes only.
const crypto = require('crypto');
const LoginLink = require('../models/LoginLink');
const User = require('../models/User');
const realMail = require('./mail');
const { consumeRateLimit } = require('./rateLimit');
const { consentError } = require('./consent');
const { isDuplicateEmail } = require('./duplicateKey');

const HOUR = 60 * 60 * 1000;
const PENDING_INVITES_CAP = 100;
const HISTORY_PER_USER = 5;
const SENDS_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fills in the real dependencies; a test passes only the ones it wants to fake.
function withDefaults(deps = {}) {
  return {
    LoginLink, User, mail: realMail, rateLimit: consumeRateLimit,
    now: () => new Date(),
    ...deps,
  };
}

// ---------------------------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------------------------

function newToken() {
  return crypto.randomBytes(32).toString('base64url'); // 43 characters
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// The encryption key is derived from JWT_SECRET, so a database leak alone cannot reveal links.
function encKey() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for login links');
  return crypto.createHash('sha256').update('login-link:' + process.env.JWT_SECRET).digest();
}

// base64( iv(12) | authTag(16) | ciphertext )
function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

// Returns the raw token, or null when the data was tampered with / the key changed.
function decryptToken(enc) {
  try {
    const buf = Buffer.from(String(enc), 'base64');
    if (buf.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function buildLink(token) {
  const base = (process.env.PUBLIC_BASE_URL || 'https://getpretty.app').replace(/\/+$/, '');
  return `${base}/#signin=${token}`;
}

// ---------------------------------------------------------------------------------------------
// Status and display
// ---------------------------------------------------------------------------------------------

// Order matters: a used link stays "used" even after it expires or is replaced.
function linkStatus(doc, now = new Date()) {
  if (doc.usedAt) return 'used';
  if (doc.revokedAt) return 'revoked';
  if (new Date(doc.expiresAt) <= now) return 'expired';
  return 'active';
}

// The full URL, only while the link can still be used.
function revealLink(doc, now = new Date()) {
  if (linkStatus(doc, now) !== 'active') return null;
  const token = decryptToken(doc.tokenEnc);
  return token ? buildLink(token) : null;
}

function toRow(doc, now) {
  return {
    id: String(doc._id),
    purpose: doc.purpose,
    status: linkStatus(doc, now),
    link: revealLink(doc, now),
    createdAt: doc.createdAt,
    createdByAdminEmail: doc.createdByAdminEmail,
    expiresAt: doc.expiresAt,
    usedAt: doc.usedAt || null,
    lastSentAt: doc.lastSentAt || null,
    sendCount: doc.sendCount || 0,
    lastSendError: doc.lastSendError || null,
    invite: doc.invite || null,
  };
}

async function listForUser(userId, deps) {
  const d = withDefaults(deps);
  const now = d.now();
  const docs = await d.LoginLink.find({ userId }).sort({ createdAt: -1 }).limit(HISTORY_PER_USER);
  return docs.map(doc => toRow(doc, now));
}

async function listPendingInvites(deps) {
  const d = withDefaults(deps);
  const now = d.now();
  const docs = await d.LoginLink.find({
    purpose: 'invite', usedAt: null, revokedAt: null, expiresAt: { $gt: now },
  }).sort({ createdAt: -1 }).limit(PENDING_INVITES_CAP);
  return docs.map(doc => toRow(doc, now));
}

// ---------------------------------------------------------------------------------------------
// Creating links
// ---------------------------------------------------------------------------------------------

// Inserts the row and returns { link, linkDoc }. `fields` carries purpose / userId / invite.
async function insertLink(fields, adminEmail, d) {
  const token = newToken();
  const now = d.now();
  const linkDoc = await d.LoginLink.create({
    ...fields,
    tokenHash: hashToken(token),
    tokenEnc: encryptToken(token),
    createdByAdminEmail: adminEmail,
    expiresAt: new Date(now.getTime() + d.LoginLink.LIFETIME_HOURS * HOUR),
  });
  return { link: buildLink(token), linkDoc };
}

// A new sign-in link replaces the user's older unused ones (they are marked revoked).
async function createForUser(userId, adminEmail, deps) {
  const d = withDefaults(deps);
  const now = d.now();
  await d.LoginLink.updateMany(
    { userId, purpose: 'signin', usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } }
  );
  const { link, linkDoc } = await insertLink({ purpose: 'signin', userId }, adminEmail, d);
  return { ok: true, link, linkDoc };
}

async function createInvite({ email, firstName, language } = {}, adminEmail, deps) {
  const d = withDefaults(deps);
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) return { ok: false, code: 'invite_invalid' };

  // The person already has an account: a plain sign-in link is the right thing to send.
  const existing = await d.User.findOne({ email: cleanEmail });
  if (existing) {
    const made = await createForUser(existing._id, adminEmail, deps);
    return { ...made, existingUserId: existing._id };
  }

  const now = d.now();
  await d.LoginLink.updateMany(
    { purpose: 'invite', 'invite.email': cleanEmail, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } }
  );
  const invite = {
    email: cleanEmail,
    firstName: typeof firstName === 'string' ? firstName.trim().slice(0, 100) : '',
    language: language === 'en' ? 'en' : 'he', // the clinic is Hebrew-first
  };
  const { link, linkDoc } = await insertLink({ purpose: 'invite', invite }, adminEmail, d);
  return { ok: true, link, linkDoc };
}

// ---------------------------------------------------------------------------------------------
// Emailing a link
// ---------------------------------------------------------------------------------------------

async function sendLinkEmail(linkId, deps) {
  const d = withDefaults(deps);
  const now = d.now();
  const doc = await d.LoginLink.findById(linkId);
  if (!doc || linkStatus(doc, now) !== 'active') return { ok: false, code: 'link_not_active' };

  // Who gets the email: the user for a sign-in link, the invited person for an invite.
  let to; let firstName; let language; let limitKey;
  if (doc.purpose === 'invite') {
    ({ email: to, firstName, language } = doc.invite || {});
    limitKey = to;
  } else {
    const user = doc.userId ? await d.User.findById(doc.userId) : null;
    if (!user) return { ok: false, code: 'link_not_active' };
    ({ email: to, firstName, language } = user);
    limitKey = String(user._id);
  }
  const link = revealLink(doc, now);
  if (!to || !link) return { ok: false, code: 'link_not_active' };

  if (!await d.rateLimit('link_send', limitKey, SENDS_PER_HOUR, HOUR)) return { ok: false, code: 'rate_limited' };

  try {
    await d.mail.sendSignInLink({ to, firstName, language, link, expiresAt: doc.expiresAt, purpose: doc.purpose });
  } catch (err) {
    // Store only a SHORT reason: the raw provider error could contain the address.
    const code = err && err.code === 'mail_not_configured' ? 'mail_not_configured' : 'send_failed';
    await d.LoginLink.updateOne({ _id: doc._id }, { $set: { lastSendError: code } });
    console.error(`loginLinks: email for link ${doc._id} failed (${code})`);
    return { ok: false, code };
  }
  await d.LoginLink.updateOne(
    { _id: doc._id },
    { $set: { lastSentAt: now, lastSendError: null }, $inc: { sendCount: 1 } }
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Redeeming a link
// ---------------------------------------------------------------------------------------------

/**
 * Turn a token into a user. Result: { ok:true, user, isNew } or { ok:false, code, status? }.
 * Consent errors carry the HTTP status from services/consent.js.
 */
async function redeem({ token, consentAcceptedAt, consentVersion } = {}, deps) {
  const d = withDefaults(deps);
  const now = d.now();
  const INVALID = { ok: false, code: 'link_invalid' };

  // 1. Find the link by the hash of the token.
  if (typeof token !== 'string' || !token || token.length > 200) return INVALID;
  const doc = await d.LoginLink.findOne({ tokenHash: hashToken(token) });
  if (!doc || linkStatus(doc, now) !== 'active') return INVALID;

  // 2. An invite for someone WITHOUT an account must carry valid Terms/Privacy consent.
  //    Checked BEFORE consuming, so a missing tick does not burn the link.
  let existingForInvite = null;
  if (doc.purpose === 'invite') {
    existingForInvite = await d.User.findOne({ email: doc.invite.email });
    if (!existingForInvite) {
      const problem = consentError({ consentAcceptedAt, consentVersion }, now);
      if (problem) return { ok: false, code: problem.code, status: problem.status, error: problem.error };
    }
  }

  // 3. Consume atomically: of two simultaneous redeems only one matches the filter.
  const consumed = await d.LoginLink.findOneAndUpdate(
    { _id: doc._id, usedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } }
  );
  if (!consumed) return INVALID;

  // 4a. Sign-in link: the account must still exist (it may have been deleted).
  if (doc.purpose !== 'invite') {
    const user = doc.userId ? await d.User.findById(doc.userId) : null;
    if (!user) return INVALID;
    return { ok: true, user, isNew: false };
  }

  // 4b. Invite: use the account if the email registered meanwhile, otherwise create it.
  let user = existingForInvite || await d.User.findOne({ email: doc.invite.email });
  let isNew = false;
  if (!user) {
    try {
      user = await d.User.create({
        email: doc.invite.email,
        firstName: doc.invite.firstName || undefined,
        language: doc.invite.language,
        invitedAt: now,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        consentVersion: process.env.CONSENT_VERSION,
      });
      isNew = true;
    } catch (err) {
      // Someone created the account between our lookup and insert: use theirs.
      if (!isDuplicateEmail(err)) throw err;
      user = await d.User.findOne({ email: doc.invite.email });
      if (!user) throw err;
    }
  }
  await d.LoginLink.updateOne({ _id: doc._id }, { $set: { userId: user._id } });
  return { ok: true, user, isNew };
}

module.exports = {
  createForUser, createInvite, linkStatus, revealLink, listForUser, listPendingInvites,
  sendLinkEmail, redeem,
  // exported for tests
  encryptToken, decryptToken, hashToken, buildLink,
};
