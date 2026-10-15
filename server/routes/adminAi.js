'use strict';

// Admin "AI settings" pages: edit the prompt guidance + limits of the three AI tasks, see the
// version history, restore an older version, and run one paid test on a built-in sample case.
// Mounted from routes/admin.js with `router.use('/ai', ...)`, so it inherits that router's
// helmet/CSP and urlencoded form parsing; JSON bodies are parsed by the app-wide parser.
//
// Who may do what (decision D7):
//  - every admin can OPEN the pages (read-only view);
//  - only BUILT-IN admins (the ADMIN_ALLOWED_EMAILS list) can publish, restore or test.
//    The email comes from the signed session cookie: requireAdmin puts it on req.admin.email.

const express = require('express');
const router = express.Router();

const { requireAdmin, requireCsrf, isBuiltInAdmin } = require('../services/adminAuth');
const { logAdminAction } = require('../services/adminAudit');
const { consumeRateLimit } = require('../services/rateLimit');
const messages = require('../services/messages');
const aiConfig = require('../services/aiConfig/aiConfig');
const { listSampleCases, getSampleCase } = require('../services/aiConfig/sampleCases');
const { runTestCase } = require('../services/aiConfig/testRun');

// This router's own notice texts (the URL carries only the short code, never free text).
const NOTICES = {
  ai_published: { text: 'Saved and live for new analyses.' },
  ai_restored:  { text: 'Restored. This version is now live.' },
  ai_unchanged: { text: 'Nothing changed.' },
  ai_invalid:   { text: 'Please fix the highlighted fields.', error: true },
  ai_forbidden: { text: 'Only built-in admins can change AI settings.', error: true },
};

const TEST_LIMIT_PER_HOUR = 20;

// Same job as `adminPage` in routes/admin.js: require a session and load the nav's inbox badge.
async function loadInboxBadge(req, res, next) {
  try {
    res.locals.unreadReplies = await messages.unreadRepliesCount();
  } catch (err) {
    console.error('Inbox badge count failed:', err.message);
    res.locals.unreadReplies = 0;
  }
  next();
}
const adminPage = [requireAdmin, loadInboxBadge];

// Gate for every POST: a dashboard admin who is not built-in gets 403. Runs after requireAdmin
// (needs req.admin). `json` = answer in JSON, for the fetch()-based test button.
function builtInOnly({ json = false } = {}) {
  return (req, res, next) => {
    if (isBuiltInAdmin(req.admin && req.admin.email)) return next();
    if (json) return res.status(403).json({ error: NOTICES.ai_forbidden.text });
    return res.status(403).send(NOTICES.ai_forbidden.text);
  };
}

// An unknown key in the URL is a 404 for every route.
function knownKey(req, res, next) {
  if (!aiConfig.KEYS.includes(req.params.key)) return res.status(404).send('Unknown AI setting.');
  next();
}

// "Built-in default" or "Saved by <email> on <date>" for the live version. Restoring the built-in
// default INSERTS a version (restoredFrom === 'default'), which the config service reports as
// source 'saved'; it is still the built-in text, so it is labelled "Built-in default" here.
async function describeActive(key, config) {
  if (config.source !== 'saved') return 'Built-in default';
  const [newest] = await aiConfig.listVersions(key, 1);
  if (newest && newest.id === config.versionId && newest.restoredFrom === 'default') return 'Built-in default';
  const day = config.savedAt ? new Date(config.savedAt).toISOString().slice(0, 10) : '';
  return `Saved by ${config.savedBy || 'unknown'}${day ? ` on ${day}` : ''}`;
}

// The form shape the edit view prints: the live config on GET, the typed values after a 400.
function formFromConfig(config) {
  return { guidance: config.guidance, ...config.limits, note: '' };
}

async function renderEdit(req, res, status, { key, form, errors = {}, notice = null }) {
  const [live, versions] = await Promise.all([aiConfig.getActiveConfig(key), aiConfig.listVersions(key, 50)]);
  const canEdit = isBuiltInAdmin(req.admin.email);
  // A read-only admin always sees why, unless a result banner is already showing.
  const shownNotice = notice || (canEdit ? null : NOTICES.ai_forbidden);
  res.status(status).render('admin/aiEdit', {
    admin: req.admin,
    key,
    def: aiConfig.DEFAULTS[key],
    bounds: aiConfig.BOUNDS,
    form: form || formFromConfig(live),
    errors,
    live,
    activeLabel: await describeActive(key, live),
    versions,
    sampleCases: listSampleCases(key),
    canEdit,
    notice: shownNotice,
  });
}

// ── List ────────────────────────────────────────────────────────────────────

router.get('/', adminPage, async (req, res, next) => {
  try {
    const rows = await Promise.all(aiConfig.KEYS.map(async key => ({
      key,
      title: aiConfig.DEFAULTS[key].title,
      activeLabel: await describeActive(key, await aiConfig.getActiveConfig(key)),
    })));
    res.render('admin/ai', { admin: req.admin, rows, notice: null });
  } catch (err) {
    next(err);
  }
});

// ── Edit page ───────────────────────────────────────────────────────────────

router.get('/:key', adminPage, knownKey, async (req, res, next) => {
  try {
    await renderEdit(req, res, 200, { key: req.params.key, notice: NOTICES[req.query.notice] || null });
  } catch (err) {
    next(err);
  }
});

// ── Publish ─────────────────────────────────────────────────────────────────

router.post('/:key', requireAdmin, requireCsrf, builtInOnly(), knownKey, async (req, res, next) => {
  try {
    const key = req.params.key;
    const parsed = aiConfig.parseConfigForm(req.body);
    if (!parsed.ok) {
      // Invalid: show the form again with what was typed; nothing is saved.
      const b = req.body || {};
      return renderEdit(req, res, 400, {
        key, errors: parsed.errors, notice: NOTICES.ai_invalid,
        form: { guidance: b.guidance, timeoutSec: b.timeoutSec, maxOutputTokens: b.maxOutputTokens, maxCostUsd: b.maxCostUsd, note: b.note },
      });
    }
    const saved = await aiConfig.saveVersion(key, parsed.values, req.admin.email);
    if (!saved.changed) return res.redirect(`/admin/ai/${key}?notice=ai_unchanged`);
    await logAdminAction(req, 'ai_config_published', { fields: [key] });
    res.redirect(`/admin/ai/${key}?notice=ai_published`);
  } catch (err) {
    next(err);
  }
});

// ── Restore (an older version, or versionId=default for the built-in default) ─

router.post('/:key/restore', requireAdmin, requireCsrf, builtInOnly(), knownKey, async (req, res, next) => {
  try {
    const key = req.params.key;
    const result = await aiConfig.restoreVersion(key, (req.body || {}).versionId, req.admin.email);
    // Decision: an unknown/foreign version id is a plain 404 (only a stale page or forged request does this).
    if (!result.ok) return res.status(404).send('That version no longer exists.');
    await logAdminAction(req, 'ai_config_restored', { fields: [key] });
    res.redirect(`/admin/ai/${key}?notice=ai_restored`);
  } catch (err) {
    next(err);
  }
});

// ── Test run (JSON in, JSON out). Saves nothing. ────────────────────────────

router.post('/:key/test', requireAdmin, requireCsrf, builtInOnly({ json: true }), knownKey, async (req, res, next) => {
  try {
    const key = req.params.key;
    const body = req.body || {};
    const parsed = aiConfig.parseConfigForm(body);
    if (!parsed.ok) return res.status(400).json({ error: NOTICES.ai_invalid.text, errors: parsed.errors });
    const sampleCase = getSampleCase(key, body.sampleCase);
    if (!sampleCase) return res.status(400).json({ error: 'Unknown sample case.' });

    // Each run is a paid provider call: at most 20 per admin per hour (shared RateLimitBucket mechanism).
    const allowed = await consumeRateLimit('admin_ai_test', req.admin.email, TEST_LIMIT_PER_HOUR);
    if (!allowed) return res.status(429).json({ error: 'Too many test runs this hour.' });

    const { guidance, timeoutSec, maxOutputTokens, maxCostUsd } = parsed.values;
    const result = await runTestCase(key, sampleCase, { guidance, limits: { timeoutSec, maxOutputTokens, maxCostUsd } });
    // Audit only real attempts: with no provider key nothing was called or spent.
    if (result.code !== 'BEDROCK_NOT_CONFIGURED') await logAdminAction(req, 'ai_config_tested', { fields: [key] });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
