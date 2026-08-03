const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const requireAuth = require('../middleware/auth');

function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
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
    res.status(201).json({ token: signToken(user), user: { id: user._id, firstName: user.firstName, email: normalizedEmail, termsAcceptedAt: user.termsAcceptedAt, consentVersion: user.consentVersion } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Unable to create account' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    res.json({ token: signToken(user), user: { id: user._id, firstName: user.firstName, email: user.email, termsAcceptedAt: user.termsAcceptedAt, consentVersion: user.consentVersion } });
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
