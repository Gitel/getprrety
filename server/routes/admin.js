const mongoose = require('mongoose');
const helmet = require('helmet');
const router = require('express').Router();

const SkinAnalysis = require('../models/SkinAnalysis');
const User = require('../models/User');
const Upload = require('../models/Upload');
const { notifyClinic } = require('../services/clinicNotify');
const {
  COOKIE_NAME,
  verifyGoogleCredential,
  signSession,
  cookieOptions,
  requireAdmin,
  isAllowed,
} = require('../services/adminAuth');

// The Google Identity Services button loads a script + iframe from accounts.google.com,
// which the app-wide strict helmet() CSP would block. Relax it for /admin only.
router.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      frameSrc: ['https://accounts.google.com/gsi/'],
      imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
    },
  },
}));

function adminGoogleClientId() {
  return process.env.ADMIN_GOOGLE_CLIENT_ID
    || (process.env.GOOGLE_CLIENT_IDS || '').split(',').map(v => v.trim()).filter(Boolean)[0]
    || '';
}

function publicBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

// ── Auth ────────────────────────────────────────────────────────────────────

router.get('/login', (req, res) => {
  res.render('admin/login', {
    googleClientId: adminGoogleClientId(),
    error: req.query.error || null,
  });
});

// Google Identity Services posts the signed-in user's ID token here as `credential`.
router.post('/auth/google', async (req, res) => {
  try {
    const credential = req.body && req.body.credential;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });

    let payload;
    try {
      payload = await verifyGoogleCredential(credential);
    } catch {
      return res.status(401).json({ error: 'Invalid Google sign-in' });
    }
    if (!payload || !payload.email || payload.email_verified === false) {
      return res.status(401).json({ error: 'Google account has no verified email' });
    }

    if (!isAllowed(payload.email)) {
      return res.status(403).json({ error: 'This Google account is not authorized for the dashboard.' });
    }

    res.cookie(COOKIE_NAME, signSession(payload.email), cookieOptions());
    res.json({ ok: true });
  } catch (err) {
    console.error('admin google auth error:', err);
    res.status(500).json({ error: 'Sign-in failed' });
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.redirect('/admin/login');
});

// ── Protected dashboard ─────────────────────────────────────────────────────

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const rows = await SkinAnalysis.find()
      .sort({ createdAt: -1 })
      .limit(1000)
      .populate('userId', 'firstName email')
      .lean();
    res.render('admin/list', { rows, admin: req.admin });
  } catch (err) {
    next(err);
  }
});

router.get('/customer/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Not found');
    const analysis = await SkinAnalysis.findById(req.params.id).lean();
    if (!analysis) return res.status(404).send('Not found');
    const user = analysis.userId ? await User.findById(analysis.userId).lean() : null;

    const imageIds = [...new Set([
      ...(analysis.quizPhotoIds || []),
      ...((user && user.selfiePhotoIds) || []),
      ...((user && user.shelfPhotoIds) || []),
    ].filter(Boolean).map(String))];

    res.render('admin/customer', {
      analysis,
      user,
      imageIds,
      resent: req.query.resent === '1',
      dashboardUrl: `${publicBaseUrl(req)}/admin/customer/${analysis._id}`,
      admin: req.admin,
    });
  } catch (err) {
    next(err);
  }
});

// Admin image proxy — Uploads are user-scoped on /api/uploads; admins need to see any
// client's photos. Membership-checked so this isn't an open image enumerator.
router.get('/customer/:id/image/:uploadId', requireAdmin, async (req, res, next) => {
  try {
    const { id, uploadId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(uploadId)) {
      return res.status(404).send('Not found');
    }
    const analysis = await SkinAnalysis.findById(id).lean();
    if (!analysis) return res.status(404).send('Not found');
    const user = analysis.userId ? await User.findById(analysis.userId).lean() : null;
    const allowed = new Set([
      ...(analysis.quizPhotoIds || []),
      ...((user && user.selfiePhotoIds) || []),
      ...((user && user.shelfPhotoIds) || []),
    ].filter(Boolean).map(String));
    if (!allowed.has(String(uploadId))) return res.status(404).send('Not found');

    const doc = await Upload.findById(uploadId);
    if (!doc) return res.status(404).send('Not found');
    res.set('Content-Type', doc.mimeType || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(doc.data);
  } catch (err) {
    next(err);
  }
});

router.post('/customer/:id/resend', requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Not found');
    await notifyClinic(req.params.id, { force: true });
    res.redirect(`/admin/customer/${req.params.id}?resent=1`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
