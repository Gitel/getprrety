const mongoose = require('mongoose');
const multer = require('multer');
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
const catalogue = require('../services/catalogueProducts');
const { deleteUserAndData } = require('../services/deleteUser');
const bookings = require('../services/bookings');

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
  catalogue_created:       { text: 'Product created.' },
  catalogue_saved:         { text: 'Product saved.' },
  catalogue_unchanged:     { text: 'Nothing changed.' },
  catalogue_invalid:       { text: 'Please fill in the name and choose a valid category, use and pregnancy option.', error: true },
  catalogue_name_taken:    { text: 'A product with this name already exists.', error: true },
  catalogue_photo_saved:   { text: 'Photo updated.' },
  catalogue_photo_invalid: { text: 'The photo must be a JPEG or PNG image of up to 2 MB.', error: true },
  catalogue_archived:      { text: 'Product archived.' },
  catalogue_restored:      { text: 'Product restored.' },
  booking_cancelled:         { text: 'Booking cancelled and removed from the calendar.' },
  booking_not_found:         { text: 'That booking no longer exists.', error: true },
  booking_already_cancelled: { text: 'That booking was already cancelled.', error: true },
  booking_calendar_failed:   { text: 'The calendar could not be reached, so nothing was cancelled. Please try again.', error: true },
  booking_settings_saved:    { text: 'Booking settings saved.' },
  booking_settings_unchanged: { text: 'Nothing changed.' },
  booking_settings_invalid:  { text: 'Please check the settings: times must be HH:MM, closing after opening, and the numbers within range.', error: true },
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
  // helmet's default `no-referrer` makes browsers send `Origin: null` on the dashboard's own
  // form POSTs (form navigations only: fetch() in cors mode always sends the real origin),
  // and the app-wide CORS check (server/index.js) answers that
  // with 403 "Origin not allowed". `same-origin` sends the real origin (and referrer) only to
  // this site; other sites still get nothing. Found by the admin e2e suite (2026-10-06).
  referrerPolicy: { policy: 'same-origin' },
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
    // Bookings card: every booking of this user, newest first.
    const userBookings = await bookings.listForUser(detail.user._id);
    res.render('admin/user', {
      admin: req.admin, ...detail, thread, bookings: userBookings, notice: noticeFrom(req), maxMessage: messages.MAX_BODY,
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

// ── Catalogue ───────────────────────────────────────────────────────────────

// Photo uploads: kept in memory (the bytes go straight into MongoDB), one file of at most
// 2 MB plus the _csrf text field. The limits stop a client from sending huge or many parts.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: catalogue.PHOTO_UPLOAD_LIMITS,
}).single('photo');

// What the product form shows, as plain strings. `source` is either a stored product (lists
// become one item per line) or a submitted body (kept exactly as typed, so a 400 re-render
// does not lose the admin's work).
function formValues(source) {
  const str = v => (typeof v === 'string' ? v : '');
  const list = v => (Array.isArray(v) ? v.join('\n') : str(v));
  const s = source || {};
  return {
    name: str(s.name), category: str(s.category), use: str(s.use), pregnancy: str(s.pregnancy),
    keyActives: list(s.keyActives), ingredients: str(s.ingredients),
    strengths: list(s.strengths), suitableFor: list(s.suitableFor),
  };
}

// One view serves both "new" (product = null) and "edit".
function renderProductForm(req, res, { product, values, notice, status = 200 }) {
  res.status(status).render('admin/catalogueProduct', {
    admin: req.admin,
    product,
    values,
    notice,
    categoryLabels: catalogue.CATEGORY_LABELS,
    useLabels: catalogue.USE_LABELS,
    pregnancyLabels: catalogue.PREGNANCY_LABELS,
  });
}

// List: every product (archived included), grouped by category, photo bytes not loaded.
router.get('/catalogue', adminPage, async (req, res, next) => {
  try {
    res.render('admin/catalogue', {
      admin: req.admin,
      products: await catalogue.listProducts(),
      categoryLabels: catalogue.CATEGORY_LABELS,
      useLabels: catalogue.USE_LABELS,
      pregnancyLabels: catalogue.PREGNANCY_LABELS,
      notice: noticeFrom(req),
    });
  } catch (err) {
    next(err);
  }
});

// Registered BEFORE /catalogue/:id, otherwise "new" would be read as an id.
router.get('/catalogue/new', adminPage, (req, res) => {
  renderProductForm(req, res, { product: null, values: formValues(null), notice: noticeFrom(req) });
});

// Create. Invalid input re-renders the form (400) with what was typed.
router.post('/catalogue', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await catalogue.createProduct(req.body);
    if (!result.ok) {
      return renderProductForm(req, res, {
        product: null, values: formValues(req.body), notice: NOTICES[result.code], status: 400,
      });
    }
    // The audit entry lists the form fields the admin filled in (name is always one).
    const typed = formValues(req.body);
    const filled = Object.keys(typed).filter(k => typed[k].trim());
    await logAdminAction(req, 'catalogue_product_created', { catalogueProductId: result.id, fields: filled });
    res.redirect(`/admin/catalogue/${result.id}?notice=catalogue_created`);
  } catch (err) {
    next(err);
  }
});

// Photo bytes for the list thumbnails and the edit page. Not found / no photo -> 404.
router.get('/catalogue/:id/photo', requireAdmin, async (req, res, next) => {
  try {
    const photo = await catalogue.getProductPhoto(req.params.id);
    if (!photo) return res.status(404).send('Not found');
    res.set('Content-Type', photo.mimeType || 'image/jpeg');
    // The URL stays the same when the photo is replaced, so the browser must revalidate each
    // time; Express's automatic ETag turns an unchanged photo into a cheap 304.
    res.set('Cache-Control', 'private, no-cache');
    res.send(photo.data);
  } catch (err) {
    next(err);
  }
});

router.get('/catalogue/:id', adminPage, async (req, res, next) => {
  try {
    const product = await catalogue.getProduct(req.params.id);
    if (!product) return res.status(404).send('Not found');
    renderProductForm(req, res, { product, values: formValues(product), notice: noticeFrom(req) });
  } catch (err) {
    next(err);
  }
});

// Save the edit form. Only changed field names are audited, never values.
router.post('/catalogue/:id', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await catalogue.updateProduct(req.params.id, req.body);
    if (!result.ok && result.code === 'not_found') return res.status(404).send('Not found');
    const back = `/admin/catalogue/${req.params.id}`;
    if (!result.ok) {
      // Re-render with the typed values; the product itself is only needed for slug/photo/dates.
      const product = await catalogue.getProduct(req.params.id);
      if (!product) return res.status(404).send('Not found');
      return renderProductForm(req, res, {
        product, values: formValues(req.body), notice: NOTICES[result.code], status: 400,
      });
    }
    if (!result.changed.length) return res.redirect(`${back}?notice=catalogue_unchanged`);
    await logAdminAction(req, 'catalogue_product_updated', {
      catalogueProductId: req.params.id, fields: result.changed,
    });
    res.redirect(`${back}?notice=catalogue_saved`);
  } catch (err) {
    next(err);
  }
});

// Photo upload (multipart). Order: admin check, parse the multipart body, CSRF check (the
// token is a form field, so it only exists after multer has parsed the body).
router.post('/catalogue/:id/photo', requireAdmin, (req, res, next) => {
  photoUpload(req, res, err => {
    if (!err) return next();
    // Too big / too many parts / wrong field. Skipping the CSRF check here is safe because
    // nothing is written: we only redirect back to the page with an error banner. Handling
    // it here also keeps multer errors away from the global JSON error handler.
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Not found');
    res.redirect(`/admin/catalogue/${req.params.id}?notice=catalogue_photo_invalid`);
  });
}, requireCsrf, async (req, res, next) => {
  try {
    const result = await catalogue.replacePhoto(req.params.id, req.file);
    if (!result.ok && result.code === 'not_found') return res.status(404).send('Not found');
    const back = `/admin/catalogue/${req.params.id}`;
    if (!result.ok) return res.redirect(`${back}?notice=${result.code}`);
    await logAdminAction(req, 'catalogue_photo_replaced', {
      catalogueProductId: req.params.id, fields: ['photo'],
    });
    res.redirect(`${back}?notice=catalogue_photo_saved`);
  } catch (err) {
    next(err);
  }
});

// Archive / restore. The audit entry is written only when the state really changed.
function archiveHandler(archived, action, notice) {
  return async (req, res, next) => {
    try {
      const result = await catalogue.setArchived(req.params.id, archived);
      if (!result.ok) return res.status(404).send('Not found');
      if (result.changed) {
        await logAdminAction(req, action, { catalogueProductId: req.params.id, fields: ['archived'] });
      }
      res.redirect(`/admin/catalogue/${req.params.id}?notice=${notice}`);
    } catch (err) {
      next(err);
    }
  };
}
router.post('/catalogue/:id/archive', requireAdmin, requireCsrf,
  archiveHandler(true, 'catalogue_product_archived', 'catalogue_archived'));
router.post('/catalogue/:id/restore', requireAdmin, requireCsrf,
  archiveHandler(false, 'catalogue_product_restored', 'catalogue_restored'));

// ג”€ג”€ Bookings ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€ג”€

const BOOKING_TABS = ['upcoming', 'past', 'cancelled'];

// Service error code -> notice code for a failed cancel.
const CANCEL_NOTICES = {
  not_found: 'booking_not_found',
  already_cancelled: 'booking_already_cancelled',
  calendar_unavailable: 'booking_calendar_failed',
};

// List of bookings, one tab at a time (an unknown ?tab= falls back to upcoming).
router.get('/bookings', adminPage, async (req, res, next) => {
  try {
    const tab = BOOKING_TABS.includes(req.query.tab) ? req.query.tab : 'upcoming';
    res.render('admin/bookings', {
      admin: req.admin, tab, rows: await bookings.listForAdmin({ tab }), notice: noticeFrom(req),
    });
  } catch (err) {
    next(err);
  }
});

// Cancel removes the calendar event first, then marks the booking cancelled (service order).
// The audit entry is written only when the cancel really happened.
router.post('/bookings/:id/cancel', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await bookings.cancelBooking(req.params.id, req.admin.email);
    if (!result.ok) {
      return res.redirect(`/admin/bookings?notice=${CANCEL_NOTICES[result.code] || 'booking_not_found'}`);
    }
    await logAdminAction(req, 'booking_cancelled', {
      userId: result.booking.userId, bookingId: result.booking._id || req.params.id,
    });
    res.redirect('/admin/bookings?notice=booking_cancelled');
  } catch (err) {
    next(err);
  }
});

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Turns the stored config into the flat shape the settings form shows
// (days[d] = { enabled, open, close }; a day missing from `weekly` is closed).
function settingsFormFromConfig(config) {
  const days = WEEKDAYS.map((_, d) => {
    const w = (config.weekly || []).find(x => x.day === d);
    return { enabled: Boolean(w), open: w ? w.open : '', close: w ? w.close : '' };
  });
  return {
    enabled: Boolean(config.enabled),
    slotMinutes: config.slotMinutes,
    bufferMinutes: config.bufferMinutes,
    leadHours: config.leadHours,
    horizonDays: config.horizonDays,
    days,
  };
}

// Same shape, built from what the admin typed (used to re-show the form after an error).
function settingsFormFromBody(body) {
  return {
    enabled: Boolean(body.enabled),
    slotMinutes: body.slotMinutes,
    bufferMinutes: body.bufferMinutes,
    leadHours: body.leadHours,
    horizonDays: body.horizonDays,
    days: WEEKDAYS.map((_, d) => ({
      enabled: Boolean(body[`day${d}_enabled`]),
      open: body[`day${d}_open`] || '',
      close: body[`day${d}_close`] || '',
    })),
  };
}

function renderBookingSettings(req, res, status, form, notice) {
  res.status(status).render('admin/bookingSettings', {
    admin: req.admin, form, weekdays: WEEKDAYS, slotOptions: [15, 20, 30, 45, 60], notice,
  });
}

router.get('/booking-settings', adminPage, async (req, res, next) => {
  try {
    const config = await bookings.getConfig();
    renderBookingSettings(req, res, 200, settingsFormFromConfig(config), noticeFrom(req));
  } catch (err) {
    next(err);
  }
});

router.post('/booking-settings', requireAdmin, requireCsrf, async (req, res, next) => {
  try {
    const result = await bookings.updateConfig(req.body);
    if (!result.ok) {
      // Invalid: show the form again with the typed values, nothing saved.
      return renderBookingSettings(req, res, 400, settingsFormFromBody(req.body), NOTICES.booking_settings_invalid);
    }
    if (!result.changed.length) return res.redirect('/admin/booking-settings?notice=booking_settings_unchanged');
    await logAdminAction(req, 'booking_settings_updated', { fields: result.changed });
    res.redirect('/admin/booking-settings?notice=booking_settings_saved');
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
