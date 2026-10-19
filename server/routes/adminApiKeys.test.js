jest.mock('../services/adminAuth', () => ({ requireAdmin: jest.fn(), requireCsrf: jest.fn(), isBuiltInAdmin: jest.fn() }));
jest.mock('../services/adminAudit', () => ({ logAdminAction: jest.fn() }));
jest.mock('../services/rateLimit', () => ({ consumeRateLimit: jest.fn() }));
jest.mock('../services/messages', () => ({ unreadRepliesCount: jest.fn(async () => 0) }));
jest.mock('../services/providerCredentials', () => ({
  PROVIDERS: { perfectcorp: { name: 'PerfectCorp' }, anthropic: { name: 'Anthropic' } },
  listStatus: jest.fn(async () => []), storageReady: jest.fn(() => true),
  saveKey: jest.fn(), checkCurrent: jest.fn(),
}));

const router = require('./adminApiKeys');
const { requireAdmin, requireCsrf, isBuiltInAdmin } = require('../services/adminAuth');
const { logAdminAction } = require('../services/adminAudit');
const { consumeRateLimit } = require('../services/rateLimit');
const credentials = require('../services/providerCredentials');
const layer = (path, method = 'post') => router.stack.find(l => l.route?.path === path && l.route.methods[method]);
const chain = (path, method = 'post') => layer(path, method).route.stack.map(s => s.handle);
const handler = (path, method = 'post') => chain(path, method).at(-1);
const req = () => ({ params: { provider: 'perfectcorp' }, admin: { email: 'boss@example.com' }, body: { apiKey: 'synthetic-secret' }, query: {} });
const res = () => ({
  statusCode: 200, locals: {},
  status(n) { this.statusCode = n; return this; }, send(v) { this.body = v; return this; },
  render(view, data) { this.view = view; this.data = data; return this; },
  redirect(url) { this.redirected = url; }, set: jest.fn(),
});
beforeEach(() => {
  jest.clearAllMocks();
  isBuiltInAdmin.mockReturnValue(true);
  consumeRateLimit.mockResolvedValue(true);
});

test.each(['/:provider', '/:provider/check'])('POST %s requires authentication, CSRF and built-in permission', path => {
  const middleware = chain(path);
  expect(middleware.slice(0, 2)).toEqual([requireAdmin, requireCsrf]);
  isBuiltInAdmin.mockReturnValue(false);
  const response = res();
  const next = jest.fn();
  middleware[2](req(), response, next);
  expect(response.statusCode).toBe(403);
  expect(next).not.toHaveBeenCalled();
});

test('GET requires an admin, sets no-store and returns only service metadata', async () => {
  expect(chain('/', 'get')[0]).toBe(requireAdmin);
  const response = res();
  router.stack[0].handle(req(), response, jest.fn());
  expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  await handler('/', 'get')(req(), response, jest.fn());
  expect(response.data).not.toHaveProperty('apiKey');
  expect(JSON.stringify(response.data)).not.toContain('synthetic-secret');
});

test.each(['/:provider', '/:provider/check'])('unknown providers are rejected before calling services: %s', path => {
  const next = jest.fn();
  const request = req(); request.params.provider = '__proto__';
  const response = res();
  chain(path)[3](request, response, next);
  expect(response.statusCode).toBe(404);
  expect(next).not.toHaveBeenCalled();
});

test.each(['/:provider', '/:provider/check'])('rate limit blocks provider requests for %s', async path => {
  consumeRateLimit.mockResolvedValue(false);
  const response = res();
  await handler(path)(req(), response, jest.fn());
  expect(response.statusCode).toBe(429);
  expect(credentials.saveKey).not.toHaveBeenCalled();
  expect(credentials.checkCurrent).not.toHaveBeenCalled();
});

test('successful replacement audits only the provider and redirects', async () => {
  credentials.saveKey.mockResolvedValue({ ok: true });
  const request = req(); const response = res();
  await handler('/:provider')(request, response, jest.fn());
  expect(logAdminAction).toHaveBeenCalledWith(request, 'api_key_replaced', { fields: ['perfectcorp'] });
  expect(response.redirected).toBe('/admin/api-keys?saved=1');
});

test('failed candidate is not echoed or audited as a replacement', async () => {
  credentials.saveKey.mockResolvedValue({ ok: false, message: 'Expired - replace this API key.' });
  const response = res();
  await handler('/:provider')(req(), response, jest.fn());
  expect(response.statusCode).toBe(400);
  expect(response.data.notice.text).toContain('The current key was kept.');
  expect(JSON.stringify(response.data)).not.toContain('synthetic-secret');
  expect(logAdminAction).not.toHaveBeenCalled();
});

test('manual check renders the actual provider health and audits without credential values', async () => {
  credentials.checkCurrent.mockResolvedValue({ ok: false, health: 'expired', message: 'Expired' });
  const request = req(); const response = res();
  await handler('/:provider/check')(request, response, jest.fn());
  expect(response.data.notice).toEqual({ error: true, text: 'PerfectCorp: Expired' });
  expect(logAdminAction).toHaveBeenCalledWith(request, 'api_key_checked', { fields: ['perfectcorp'] });
});

test.each(['/:provider', '/:provider/check'])('raw exceptions are sanitized for %s', async path => {
  credentials.saveKey.mockRejectedValue(new Error('synthetic-secret'));
  credentials.checkCurrent.mockRejectedValue(new Error('synthetic-secret'));
  const next = jest.fn();
  await handler(path)(req(), res(), next);
  expect(next).toHaveBeenCalledWith(expect.any(Error));
  expect(next.mock.calls[0][0].message).not.toContain('synthetic-secret');
});
