import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const envBefore = { ...process.env };
let server, base, auth, credentials, docs, audits;
let checkedRequests = 0;
const originalFetch = global.fetch;
const restorers = [];
function replace(object, name, value) {
  const original = object[name];
  restorers.push(() => { object[name] = original; });
  object[name] = value;
}

test.beforeAll(async () => {
  process.env.ADMIN_ALLOWED_EMAILS = 'owner@example.com';
  process.env.ADMIN_SESSION_SECRET = 'synthetic-browser-session-secret';
  process.env.API_KEYS_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  process.env.PERFECTCORP_API_KEY = 'expired-synthetic-key';
  delete process.env.ANTHROPIC_API_KEY;
  // Fake only external dependencies: exercise the real auth, CSRF, crypto, service, routes and EJS.
  const mongoose = require('mongoose');
  replace(mongoose, 'connect', () => { throw new Error('Database access is forbidden in this fixture.'); });
  const model = require('./models/ProviderCredential');
  replace(model, 'findById', id => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => docs.get(id) || null }) }) }));
  replace(model, 'findByIdAndUpdate', async (id, update) => { docs.set(id, { ...docs.get(id), ...update.$set }); });
  replace(model, 'updateOne', async (filter, update) => {
    const doc = docs.get(filter._id);
    const matches = typeof filter.fingerprint === 'object' ? !doc?.fingerprint : doc?.fingerprint === filter.fingerprint;
    if (matches) docs.set(filter._id, { ...doc, ...update.$set });
  });
  replace(require('./models/AdminUser'), 'exists', async () => true);
  replace(require('./services/rateLimit'), 'consumeRateLimit', async () => true);
  replace(require('./services/messages'), 'unreadRepliesCount', async () => 0);
  replace(require('./services/adminAudit'), 'logAdminAction', async (_req, action, target) => { audits.push({ action, ...target }); });
  credentials = require('./services/providerCredentials');
  auth = require('./services/adminAuth');
  global.fetch = async (url, options) => {
    checkedRequests++;
    const key = options.headers['x-api-key'] || options.headers.Authorization?.slice(7);
    if (key === 'expired-synthetic-key') return { ok: false, status: 401, json: async () => ({ error_code: 'ExpiredApiKey' }) };
    return { ok: true, status: 200, json: async () => url.includes('anthropic') ? { id: 'claude-opus-5-5' }
      : { data: { files: [{ file_id: 'fake', requests: [{ url: 'https://example.invalid/upload' }] }] } } };
  };
  const express = require('express');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('../server/views', import.meta.url)));
  app.use(require('cookie-parser')());
  app.use(express.urlencoded({ extended: false }));
  app.get('/admin/login', (_req, res) => res.send('Sign in'));
  app.use('/admin/api-keys', require('./routes/adminApiKeys'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { docs = new Map(); audits = []; checkedRequests = 0; });
test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  global.fetch = originalFetch;
  restorers.reverse().forEach(restore => restore());
  process.env = envBefore;
});
async function signIn(context, email = 'owner@example.com') {
  await context.addCookies([{ name: auth.COOKIE_NAME, value: auth.signSession(email), url: base, httpOnly: true }]);
}

test('an admin sees an expired key and last-check time without seeing the key', async ({ page, context }, info) => {
  await signIn(context);
  await page.goto(`${base}/admin/api-keys`);
  const response = await page.request.get(`${base}/admin/api-keys`);
  expect(response.headers()['cache-control']).toBe('no-store');
  await page.getByRole('button', { name: 'Check current PerfectCorp key' }).click();
  await expect(page.locator('#perfectcorp-title').locator('..')).toContainText('Expired - replace this API key.');
  await expect(page.locator('#perfectcorp-title').locator('..')).toContainText('UTC');
  expect(await page.content()).not.toContain('expired-synthetic-key');
  expect(checkedRequests).toBe(1);
  await page.screenshot({ path: info.outputPath('expired-api-key.png'), fullPage: true });
});

test('failed verification keeps the old key; successful save replaces it immediately and clears the input', async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${base}/admin/api-keys`);
  await page.getByLabel('New PerfectCorp API key').fill('expired-synthetic-key');
  await page.getByRole('button', { name: 'Verify and save PerfectCorp key' }).click();
  await expect(page.getByText(/The current key was kept/)).toBeVisible();
  expect(await credentials.getKey('perfectcorp')).toBe('expired-synthetic-key');
  expect(audits).toEqual([]);
  await page.getByLabel('New PerfectCorp API key').fill('new-synthetic-key');
  await page.getByRole('button', { name: 'Verify and save PerfectCorp key' }).click();
  await expect(page.getByText('API key verified, saved and live for new requests.')).toBeVisible();
  await expect(page.getByLabel('New PerfectCorp API key')).toHaveValue('');
  expect(await credentials.getKey('perfectcorp')).toBe('new-synthetic-key');
  expect(await page.content()).not.toContain('new-synthetic-key');
  expect(audits).toEqual([{ action: 'api_key_replaced', fields: ['perfectcorp'] }]);
});

test('a live credential failure becomes visible on the next admin visit', async ({ page, context }) => {
  await credentials.saveKey('anthropic', 'new-synthetic-key', 'owner@example.com');
  await credentials.recordHealth('anthropic', 'new-synthetic-key', 'rejected');
  await signIn(context);
  await page.goto(`${base}/admin/api-keys`);
  await expect(page.locator('#anthropic-title').locator('..')).toContainText('Key rejected');
});

test('a dashboard-added admin can see status but cannot replace or check a key', async ({ page, context }) => {
  await signIn(context, 'reader@example.com');
  await page.goto(`${base}/admin/api-keys`);
  await expect(page.getByText('Only built-in admins can replace or check API keys.')).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  const session = (await context.cookies()).find(cookie => cookie.name === auth.COOKIE_NAME);
  const csrf = require('jsonwebtoken').decode(session.value).csrf;
  const response = await page.request.post(`${base}/admin/api-keys/perfectcorp`, { form: { apiKey: 'new-synthetic-key', _csrf: csrf } });
  // This request has a valid session and CSRF token, so it exercises the built-in-only gate.
  expect(response.status()).toBe(403);
  expect(checkedRequests).toBe(0);
  expect(docs.size).toBe(0);
});

test('missing CSRF and logged-out access cannot change credentials', async ({ page, context }) => {
  await page.goto(`${base}/admin/api-keys`);
  await expect(page).toHaveURL(`${base}/admin/login`);
  await signIn(context);
  const response = await page.request.post(`${base}/admin/api-keys/perfectcorp`, { form: { apiKey: 'new-synthetic-key' } });
  expect(response.status()).toBe(403);
  expect(checkedRequests).toBe(0);
});
