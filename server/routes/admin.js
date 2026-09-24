const mongoose = require('mongoose');
const helmet = require('helmet');
const express = require('express');
const router = express.Router();

const SkinAnalysis = require('../models/SkinAnalysis');
const User = require('../models/User');
const Upload = require('../models/Upload');
const { notifyClinic, mailConfigError } = require('../services/clinicNotify');
const {
  COOKIE_NAME,
  verifyGoogleCredential,
  signSession,
  cookieOptions,
  requireAdmin,
  requireCsrf,
  isAllowed,
} = require('../services/adminAuth');
const { allowAuthAttempt, releaseAuthAttempt } = require('../services/authRateLimit');

// The Google Identity Services button loads a script + iframe from accounts.google.com
// and opens a sign-in popup. The app-wide strict helmet() defaults break both:
//  - its CSP blocks the GSI script/frame/connect
//  - Cross-Origin-Opener-Policy: same-origin severs window.opener, so the popup can't
//    hand the credential back and just hangs blank
// Relax both for /admin only.
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
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// Plain HTML <form method="post"> submissions arrive urlencoded. The app-wide parser only
// handles JSON, so without this every dashboard form field would be silently missing
// from req.body. Scoped to /admin: the public API has no reason to accept form posts.
router.use(express.urlencoded({ extended: false, limit: '1mb' }));

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
    // Per-IP throttle on failed sign-ins; a successful one is refunded below.
    if (!await allowAuthAttempt(req, 'admin')) {
      return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
    }
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

    // Built-in (env) admins or dashboard-added admins (AdminUser collection).
    if (!(await isAllowed(payload.email))) {
      return res.status(403).json({ error: 'This Google account is not authorized for the dashboard.' });
    }

    res.cookie(COOKIE_NAME, signSession(payload.email), cookieOptions());
    // Fire-and-forget refund: a failed refund must never fail a successful sign-in.
    releaseAuthAttempt(req, 'admin').catch(err => console.error('Admin rate-limit refund failed:', err));
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
    // mailProblem drives a banner: the clinic's own dashboard is where someone will
    // notice that no emails are going out, not the server log.
    res.render('admin/list', { rows, admin: req.admin, mailProblem: mailConfigError() });
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

router.post('/customer/:id/resend', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Not found');
    await notifyClinic(req.params.id, { force: true });
    res.redirect(`/admin/customer/${req.params.id}?resent=1`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
