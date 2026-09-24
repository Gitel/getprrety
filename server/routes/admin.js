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
const { listUsers, getUserDetail } = require('../services/userDirectory');
const { updateUserProfile, updateAnalysisSection, SECTIONS } = require('../services/adminEdits');
const { ERAS } = require('../services/eras');
const { SHELF_STATUSES } = require('../services/analysisFields');
const AdminUser = require('../models/AdminUser');
const AdminAuditLog = require('../models/AdminAuditLog');
const messages = require('../services/messages');
const { deleteUserAndData } = require('../services/deleteUser');

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
  profile_saved:           { text: 'Profile saved. The user sees it the next time the app refreshes.' },
  profile_unchanged:       { text: 'Nothing changed.' },
  profile_invalid_email:   { text: 'That is not a valid email address.', error: true },
  profile_invalid_timing:  { text: 'Routine timing must be morning, night or both.', error: true },
  profile_invalid_country: { text: 'Country must be a 2-letter code, e.g. IL or US.', error: true },
  profile_email_taken:     { text: 'Another account already uses that email address.', error: true },
  analysis_saved:          { text: 'Saved.' },
  analysis_unchanged:      { text: 'Nothing changed.' },
  analysis_invalid_era:    { text: 'Pick a Skin Era from the list.', error: true },
  analysis_notfound:       { text: 'That skin reading no longer exists.', error: true },
  message_sent:            { text: 'Message sent. The user sees it in the app the next time it refreshes.' },
  message_empty:           { text: 'Write a message first.', error: true },
  message_too_long:        { text: 'Messages can be up to 2000 characters.', error: true },
  user_deleted:            { text: 'The account and all of its data were permanently deleted.' },
  delete_confirm_mismatch: { text: 'Nothing was deleted: the email you typed does not match this account.', error: true },
};

function noticeFrom(req) {
  return NOTICES[req.query.notice] || null;
}

// Every dashboard PAGE shows the Inbox badge (unread user replies) in the nav. Runs after
// requireAdmin. If the count fails, only the badge is hidden; the page still loads.
async function loadInboxBadge(req, res, next) {
  try {
    res.locals.unreadReplies = await messages.unreadRepliesCount();
  } catch (err) {
    console.error('Inbox badge count failed:', err.message);
    res.locals.unreadReplies = 0;
  }
  next();
}

// Middleware for GET routes that render a dashboard page. Image routes and POST actions
// use requireAdmin alone: they render no nav, so they need no badge query.
const adminPage = [requireAdmin, loadInboxBadge];

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

router.get('/', adminPage, async (req, res, next) => {
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

router.get('/customer/:id', adminPage, async (req, res, next) => {
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

    // The app shows only the user's newest analysis; the page says whether this is it.
    const latest = analysis.userId
      ? await SkinAnalysis.findOne({ userId: analysis.userId }).sort({ createdAt: -1 }).select('_id').lean()
      : null;

    res.render('admin/customer', {
      analysis,
      user,
      imageIds,
      resent: req.query.resent === '1',
      dashboardUrl: `${publicBaseUrl(req)}/admin/customer/${analysis._id}`,
      admin: req.admin,
      isLatest: Boolean(latest && String(latest._id) === String(analysis._id)),
      eras: Object.values(ERAS), // the only Skin Eras an admin may pick
      shelfStatuses: SHELF_STATUSES, // the shelf statuses the app knows how to color
      notice: noticeFrom(req),
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

// Structured editors on the customer page (views/admin/_edit_*.ejs + _editor.ejs).
// Each posts JSON for one section; validation, sanitizing and change detection live in
// services/adminEdits.js. Answers JSON because the editor script reads it:
// { ok, redirect } on success, { error } otherwise.
router.post('/customer/:id/edit/:section', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const { id, section } = req.params;
    if (!Object.prototype.hasOwnProperty.call(SECTIONS, section)) {
      return res.status(404).json({ error: 'Unknown editor.' });
    }
    const result = await updateAnalysisSection(id, section, req.body);
    if (!result.ok) {
      const status = result.code === 'analysis_notfound' ? 404 : 400;
      return res.status(status).json({ error: (NOTICES[result.code] || {}).text || 'Could not save.' });
    }
    if (result.changed.length) {
      await logAdminAction(req, result.action, { userId: result.userId, analysisId: id, fields: result.changed });
    }
    const notice = result.changed.length ? 'analysis_saved' : 'analysis_unchanged';
    // #section scrolls the admin back to the editor they just used.
    res.json({ ok: true, redirect: `/admin/customer/${id}?notice=${notice}#${section}` });
  } catch (err) {
    next(err);
  }
});

// ── Users ───────────────────────────────────────────────────────────────────

// One row per account, searchable, 50 per page (see services/userDirectory.js).
router.get('/users', adminPage, async (req, res, next) => {
  try {
    const list = await listUsers({ q: req.query.q, page: req.query.page });
    res.render('admin/users', { admin: req.admin, list, notice: noticeFrom(req) });
  } catch (err) {
    next(err);
  }
});

// One account: profile, quiz completions, check-ins, logged products, activity.
router.get('/users/:id', adminPage, async (req, res, next) => {
  try {
    const detail = await getUserDetail(req.params.id);
    if (!detail) return res.status(404).send('Not found');
    // The page shows the whole message thread, so the user's replies are now seen:
    // mark them read (for every admin) and refresh the nav badge accordingly.
    const thread = await messages.threadForAdmin(detail.user._id);
    const hadUnread = thread.some(msg => msg.from === 'user' && !msg.readAt);
    if (hadUnread) {
      await messages.markReadByAdmin(detail.user._id);
      res.locals.unreadReplies = await messages.unreadRepliesCount();
    }
    res.render('admin/user', {
      admin: req.admin, ...detail, thread, notice: noticeFrom(req), maxMessage: messages.MAX_BODY,
    });
  } catch (err) {
    next(err);
  }
});

// Admin writes to the user (appears in the app's Messages screen). Plain form post.
// Only the fact that a message was sent is audited, never its text.
router.post('/users/:id/messages', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await messages.sendAdminMessage({
      userId: req.params.id,
      adminEmail: req.admin.email,
      body: req.body.body,
    });
    if (!result.ok && result.code === 'user_gone') return res.status(404).send('Not found');
    // From here the id is a valid id of an existing user, so it is safe in the URL.
    const back = `/admin/users/${req.params.id}`;
    if (!result.ok) return res.redirect(`${back}?notice=message_${result.code}#messages`);
    await logAdminAction(req, 'message_sent', { userId: req.params.id });
    res.redirect(`${back}?notice=message_sent#messages`);
  } catch (err) {
    next(err);
  }
});

// Permanently delete the account and all of its data (services/deleteUser.js).
// Requires typing the account's email. The audit entry keeps only the user id plus
// how many documents were removed per collection, never the email.
router.post('/users/:id/delete', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await deleteUserAndData(req.params.id, req.body.confirmEmail);
    if (!result.ok && result.code === 'user_notfound') return res.status(404).send('Not found');
    if (!result.ok) return res.redirect(`/admin/users/${req.params.id}?notice=${result.code}#delete`);
    await logAdminAction(req, 'user_deleted', {
      userId: req.params.id,
      fields: Object.entries(result.counts).map(([name, n]) => `${name}: ${n}`),
    });
    res.redirect('/admin/users?notice=user_deleted');
  } catch (err) {
    next(err);
  }
});

// Inbox: users with unread replies, most recent first.
router.get('/inbox', adminPage, async (req, res, next) => {
  try {
    res.render('admin/inbox', { admin: req.admin, rows: await messages.inbox() });
  } catch (err) {
    next(err);
  }
});

// Profile form on the user page. Validation and change detection live in
// services/adminEdits.js; only the names of changed fields are audited.
router.post('/users/:id/profile', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await updateUserProfile(req.params.id, req.body);
    if (!result.ok && result.code === 'user_notfound') return res.status(404).send('Not found');
    // From here the id is a valid ObjectId of an existing user, so it is safe in the URL.
    const back = `/admin/users/${req.params.id}`;
    if (!result.ok) return res.redirect(`${back}?notice=${result.code}`);
    if (!result.changed.length) return res.redirect(`${back}?notice=profile_unchanged`);
    await logAdminAction(req, 'user_profile_updated', { userId: req.params.id, fields: result.changed });
    res.redirect(`${back}?notice=profile_saved`);
  } catch (err) {
    next(err);
  }
});

// Product-log photos for the user page. /api/uploads only serves an upload to its own
// user, so admins need this route. The query requires BOTH ids to match, so it only
// ever returns this user's own uploads and cannot be used to walk other uploads by id.
router.get('/users/:id/image/:uploadId', requireAdmin, async (req, res, next) => {
  try {
    const { id, uploadId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(uploadId)) {
      return res.status(404).send('Not found');
    }
    const doc = await Upload.findOne({ _id: uploadId, userId: id });
    if (!doc) return res.status(404).send('Not found');
    res.set('Content-Type', doc.mimeType || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(doc.data);
  } catch (err) {
    next(err);
  }
});

// ── Admins ──────────────────────────────────────────────────────────────────

// Built-in admins (env) are listed from settings; dashboard admins from AdminUser.
router.get('/admins', adminPage, async (req, res, next) => {
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
router.get('/audit', adminPage, async (req, res, next) => {
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
