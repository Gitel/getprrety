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
  allowedEmails,
} = require('../services/adminAuth');
const { allowAuthAttempt, releaseAuthAttempt } = require('../services/authRateLimit');
const { logAdminAction } = require('../services/adminAudit');
const { addAdmin, removeAdmin } = require('../services/adminUsers');
const { listUsers } = require('../services/userDirectory');
const AdminUser = require('../models/AdminUser');
const AdminAuditLog = require('../models/AdminAuditLog');

// Result banners after a redirect. The URL carries only a short code (?notice=...),
// never free text, so a crafted link cannot make the dashboard display arbitrary words.
const NOTICES = {
  admin_added:    { text: 'Admin added. They can now sign in with their Google account.' },
  admin_removed:  { text: 'Admin removed. Their access ended immediately.' },
  admin_invalid:  { text: 'That is not a valid email address.', error: true },
  admin_builtin:  { text: 'That email is a built-in admin and already has access.', error: true },
  admin_exists:   { text: 'That email is already an admin.', error: true },
  admin_self:     { text: 'You cannot remove your own access.', error: true },
  admin_notfound: { text: 'That admin no longer exists.', error: true },
};

function noticeFrom(req) {
  return NOTICES[req.query.notice] || null;
}

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
    await logAdminAction(req, 'clinic_email_resent', { analysisId: req.params.id });
    res.redirect(`/admin/customer/${req.params.id}?resent=1`);
  } catch (err) {
    next(err);
  }
});

// ── Users ───────────────────────────────────────────────────────────────────

// One row per account, searchable, 50 per page (see services/userDirectory.js).
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const list = await listUsers({ q: req.query.q, page: req.query.page });
    res.render('admin/users', { admin: req.admin, list });
  } catch (err) {
    next(err);
  }
});

// ── Admins ──────────────────────────────────────────────────────────────────

// Built-in admins (env) are listed from settings; dashboard admins from AdminUser.
router.get('/admins', requireAdmin, async (req, res, next) => {
  try {
    const dbAdmins = await AdminUser.find().sort({ createdAt: 1 }).lean();
    res.render('admin/admins', { admin: req.admin, builtIn: allowedEmails(), dbAdmins, notice: noticeFrom(req) });
  } catch (err) {
    next(err);
  }
});

router.post('/admins', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await addAdmin({ email: req.body.email, addedBy: req.admin.email });
    if (!result.ok) return res.redirect(`/admin/admins?notice=admin_${result.code}`);
    await logAdminAction(req, 'admin_added', { targetAdminEmail: result.email });
    res.redirect('/admin/admins?notice=admin_added');
  } catch (err) {
    next(err);
  }
});

// Only dashboard admins have an id here, so built-in admins can never be removed.
router.post('/admins/:id/remove', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await removeAdmin({ id: req.params.id, actingEmail: req.admin.email });
    if (!result.ok) return res.redirect(`/admin/admins?notice=admin_${result.code}`);
    await logAdminAction(req, 'admin_removed', { targetAdminEmail: result.email });
    res.redirect('/admin/admins?notice=admin_removed');
  } catch (err) {
    next(err);
  }
});

// ── Audit log ───────────────────────────────────────────────────────────────

// Newest 200 entries; ?user=<id> narrows to one user (ignored unless a valid id).
router.get('/audit', requireAdmin, async (req, res, next) => {
  try {
    const filterUserId = mongoose.isValidObjectId(req.query.user) ? String(req.query.user) : null;
    const entries = await AdminAuditLog.find(filterUserId ? { userId: filterUserId } : {})
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.render('admin/audit', { admin: req.admin, entries, filterUserId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
