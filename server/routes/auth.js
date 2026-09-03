const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');
const { allowAuthAttempt } = require('../services/authRateLimit');

const TOO_MANY = { error: 'Too many attempts. Please wait a few minutes and try again.' };

const googleClient = new OAuth2Client();

function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function toPublicUser(user) {
  return { id: user._id, firstName: user.firstName, email: user.email, termsAcceptedAt: user.termsAcceptedAt, consentVersion: user.consentVersion };
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    if (!await allowAuthAttempt(req, 'signup')) return res.status(429).json(TOO_MANY);
    const { email, password, firstName, consentAcceptedAt, consentVersion } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const acceptedAt = new Date(consentAcceptedAt);
    const now = new Date();
    const activeConsentVersion = process.env.CONSENT_VERSION;
    if (!activeConsentVersion) return res.status(503).json({ error: 'Account creation is temporarily unavailable' });
    if (!consentAcceptedAt || Number.isNaN(acceptedAt.getTime()) || acceptedAt > now || now - acceptedAt > 24 * 60 * 60 * 1000)
      return res.status(400).json({ error: 'Terms and privacy consent is required' });
    if (consentVersion !== activeConsentVersion)
      return res.status(400).json({ error: 'Please review the current Terms and Privacy Policy' });

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
      return res.status(400).json({ error: 'Enter a valid email address' });
    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      consentVersion: activeConsentVersion,
      ...(typeof firstName === 'string' && firstName.trim() ? { firstName: firstName.trim().slice(0, 100) } : {}),
    });
    res.status(201).json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Unable to create account' });
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
      return res.status(400).json({ error: 'idToken is required' });

    const audience = (process.env.GOOGLE_CLIENT_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
    if (!audience.length) return res.status(503).json({ error: 'Google sign-in is temporarily unavailable' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Invalid Google sign-in token' });
    }

    if (!payload?.email || payload.email_verified === false)
      return res.status(400).json({ error: 'Google account has no verified email' });

    const googleId = payload.sub;
    const normalizedEmail = payload.email.trim().toLowerCase();

    let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });
    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      user = await User.create({
        googleId,
        email: normalizedEmail,
        ...(payload.given_name ? { firstName: String(payload.given_name).slice(0, 100) } : {}),
      });
    }

    res.json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Unable to sign in with Google' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    if (!await allowAuthAttempt(req, 'login')) return res.status(429).json(TOO_MANY);
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    res.json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Unable to log in' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Unable to load account' });
  }
});

module.exports = router;
