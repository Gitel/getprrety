const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');
const { allowAuthAttempt, releaseAuthAttempt } = require('../services/authRateLimit');
const { isDuplicateEmail } = require('../services/duplicateKey');
const { consentError } = require('../services/consent');

// Every error body carries the English `error` (old app versions read it) plus a
// machine-readable `code` that the client translates into the user's language.
const TOO_MANY = { error: 'Too many attempts. Please wait a few minutes and try again.', code: 'too_many_attempts' };

const googleClient = new OAuth2Client();

function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// skincareTiming is included so the client can tell a first-time user (not yet through
// the SkinTiming onboarding screen) from a returning one right after login/signup.
// language is the saved app language ('en' | 'he'), or null when the user never chose.
function toPublicUser(user) {
  return { id: user._id, firstName: user.firstName, email: user.email, termsAcceptedAt: user.termsAcceptedAt, consentVersion: user.consentVersion, skincareTiming: user.skincareTiming, language: user.language ?? null };
}

// Fire-and-forget: a refund that fails must never turn a successful signup into a
// 500. Awaiting it inside the route's try block would do exactly that.
function releaseQuietly(req, kind) {
  releaseAuthAttempt(req, kind).catch(err => console.error(`Auth rate-limit refund failed (${kind}):`, err));
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    if (!await allowAuthAttempt(req, 'signup')) return res.status(429).json(TOO_MANY);
    const { email, password, firstName, consentAcceptedAt, consentVersion } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password)
      return res.status(400).json({ error: 'Email and password are required', code: 'email_password_required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters', code: 'password_too_short', params: { min: 8 } });
    // Same consent rule as a new Google account (services/consent.js).
    const now = new Date();
    const consentProblem = consentError({ consentAcceptedAt, consentVersion }, now);
    if (consentProblem) return res.status(consentProblem.status).json({ error: consentProblem.error, code: consentProblem.code });
    const activeConsentVersion = process.env.CONSENT_VERSION;

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
      return res.status(400).json({ error: 'Enter a valid email address', code: 'invalid_email' });
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(409).json({ error: 'Email already registered', code: 'email_taken' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      consentVersion: activeConsentVersion,
      ...(typeof firstName === 'string' && firstName.trim() ? { firstName: firstName.trim().slice(0, 100) } : {}),
    });
    // Unlike login and google, a completed signup is not gated on proving a credential —
    // any script can mint a new email and succeed every time. Refunding here would make
    // the auth_signup bucket accumulate only failures, turning a shared-IP hourly cap
    // into unbounded account creation and unbounded bcrypt-cost-12 work. The hourly limit
    // (raised to 30) absorbs the clinic shared-IP case on its own instead.
    res.status(201).json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    if (isDuplicateEmail(err)) return res.status(409).json({ error: 'Email already registered', code: 'email_taken' });
    // A duplicate on some other unique index is our problem, not the caller's email.
    // Telling them an unused address is taken is what hid a googleId_1 collision for
    // as long as it did, so log which index it actually was.
    if (err.code === 11000) console.error('Signup duplicate key on a non-email index:', err.keyPattern || err.message);
    res.status(500).json({ error: 'Unable to create account', code: 'signup_failed' });
  }
});

// POST /api/auth/google
// Verifies a Google ID token and either logs the matching user in (linking their
// Google account if they'd previously signed up with a password) or creates a new
// account — "Sign in with Google" is one button for both cases, never a hard block.
router.post('/google', async (req, res) => {
  try {
    if (!await allowAuthAttempt(req, 'google')) return res.status(429).json(TOO_MANY);
    const { idToken } = req.body;
    if (typeof idToken !== 'string' || !idToken)
      return res.status(400).json({ error: 'idToken is required', code: 'google_token_required' });

    const audience = (process.env.GOOGLE_CLIENT_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
    if (!audience.length) return res.status(503).json({ error: 'Google sign-in is temporarily unavailable', code: 'google_unavailable' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Invalid Google sign-in token', code: 'google_token_invalid' });
    }

    if (!payload?.email || payload.email_verified === false)
      return res.status(400).json({ error: 'Google account has no verified email', code: 'google_email_unverified' });

    const googleId = payload.sub;
    const normalizedEmail = payload.email.trim().toLowerCase();

    let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });
    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      // Creating an account: Google must meet the same Terms/Privacy rule as email signup.
      // Existing users (the branch above) log in without it, exactly as before.
      const now = new Date();
      const consentProblem = consentError(req.body, now);
      if (consentProblem) return res.status(consentProblem.status).json({ error: consentProblem.error, code: consentProblem.code });
      user = await User.create({
        googleId,
        email: normalizedEmail,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        consentVersion: process.env.CONSENT_VERSION,
        ...(payload.given_name ? { firstName: String(payload.given_name).slice(0, 100) } : {}),
      });
    }

    releaseQuietly(req, 'google');
    res.json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    if (isDuplicateEmail(err)) return res.status(409).json({ error: 'Email already registered', code: 'email_taken' });
    if (err.code === 11000) console.error('Google sign-in duplicate key on a non-email index:', err.keyPattern || err.message);
    res.status(500).json({ error: 'Unable to sign in with Google', code: 'google_signin_failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    if (!await allowAuthAttempt(req, 'login')) return res.status(429).json(TOO_MANY);
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password)
      return res.status(400).json({ error: 'Email and password are required', code: 'email_password_required' });
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid email or password', code: 'invalid_credentials' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password', code: 'invalid_credentials' });

    releaseQuietly(req, 'login');
    res.json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Unable to log in', code: 'login_failed' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found', code: 'user_not_found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Unable to load account', code: 'account_load_failed' });
  }
});

module.exports = router;
