const router = require('express').Router();
const { requireAdmin, requireCsrf, isBuiltInAdmin } = require('../services/adminAuth');
const { logAdminAction } = require('../services/adminAudit');
const { consumeRateLimit } = require('../services/rateLimit');
const credentials = require('../services/providerCredentials');
const messages = require('../services/messages');

// Every response is private: neither a shared cache nor browser history should retain this page.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

async function renderPage(req, res, status = 200, notice = null) {
  let unreadReplies = 0;
  try { unreadReplies = await messages.unreadRepliesCount(); } catch { /* Badge is optional. */ }
  res.status(status).render('admin/apiKeys', {
    admin: req.admin, unreadReplies, notice,
    rows: await credentials.listStatus(), storageReady: credentials.storageReady(),
    canEdit: isBuiltInAdmin(req.admin.email),
  });
}

function builtInOnly(req, res, next) {
  if (!isBuiltInAdmin(req.admin.email)) return res.status(403).send('Only built-in admins can manage API keys.');
  next();
}

function knownProvider(req, res, next) {
  if (!Object.hasOwn(credentials.PROVIDERS, req.params.provider)) return res.status(404).send('Unknown API provider.');
  next();
}

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    await renderPage(req, res, 200, req.query.saved === '1' ? { text: 'API key verified, saved and live for new requests.' } : null);
  } catch { next(new Error('API key settings could not be loaded.')); }
});

// The key is POSTed once over HTTPS. It is never put into a URL, rendered back into a form,
// or included in an audit entry, even when verification or persistence fails.
router.post('/:provider', requireAdmin, requireCsrf, builtInOnly, knownProvider, async (req, res, next) => {
  try {
    if (!await consumeRateLimit('admin_api_keys', req.admin.email, 20)) {
      return await renderPage(req, res, 429, { error: true, text: 'Too many key checks this hour. Please try again later.' });
    }
    const result = await credentials.saveKey(req.params.provider, req.body?.apiKey, req.admin.email);
    if (!result.ok) return await renderPage(req, res, 400, { error: true, text: `${result.message} The current key was kept.` });
    await logAdminAction(req, 'api_key_replaced', { fields: [req.params.provider] });
    // Redirect after a successful form POST prevents a refresh from replacing the key again.
    res.redirect('/admin/api-keys?saved=1');
  } catch {
    // Do not forward an exception that could embed a submitted body or provider header.
    next(new Error('API key could not be saved.'));
  }
});

router.post('/:provider/check', requireAdmin, requireCsrf, builtInOnly, knownProvider, async (req, res, next) => {
  try {
    if (!await consumeRateLimit('admin_api_keys', req.admin.email, 20)) {
      return await renderPage(req, res, 429, { error: true, text: 'Too many key checks this hour. Please try again later.' });
    }
    const result = await credentials.checkCurrent(req.params.provider);
    await logAdminAction(req, 'api_key_checked', { fields: [req.params.provider] });
    await renderPage(req, res, 200, { error: !result.ok, text: `${credentials.PROVIDERS[req.params.provider].name}: ${result.message}` });
  } catch {
    next(new Error('API key could not be checked.'));
  }
});

module.exports = router;
