// Unit tests for routes/adminAi.js: handlers are called directly (fake req/res) and every
// service is mocked, so no database or paid provider call is involved.
jest.mock('../services/adminAuth', () => ({
  requireAdmin: jest.fn(), requireCsrf: jest.fn(), isBuiltInAdmin: jest.fn(),
}));
jest.mock('../services/adminAudit', () => ({ logAdminAction: jest.fn() }));
jest.mock('../services/rateLimit', () => ({ consumeRateLimit: jest.fn() }));
jest.mock('../services/messages', () => ({ unreadRepliesCount: jest.fn() }));
jest.mock('../services/aiConfig/testRun', () => ({ runTestCase: jest.fn() }));
jest.mock('../services/aiConfig/aiConfig', () => {
  const actual = jest.requireActual('../services/aiConfig/aiConfig');
  return {
    ...actual,
    getActiveConfig: jest.fn(), saveVersion: jest.fn(), listVersions: jest.fn(), restoreVersion: jest.fn(),
  };
});

const router = require('./adminAi');
const { requireCsrf, isBuiltInAdmin } = require('../services/adminAuth');
const { logAdminAction } = require('../services/adminAudit');
const { consumeRateLimit } = require('../services/rateLimit');
const { runTestCase } = require('../services/aiConfig/testRun');
const aiConfig = require('../services/aiConfig/aiConfig');

const layerFor = (path, method) => router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
const handlerFor = (path, method = 'post') => { const s = layerFor(path, method).route.stack; return s[s.length - 1].handle; };
// The middleware chain of a route (requireAdmin, requireCsrf, gate, knownKey, handler).
const chainFor = (path, method = 'post') => layerFor(path, method).route.stack.map(s => s.handle);

function fakeRes() {
  return {
    statusCode: 200, body: null, redirected: null, locals: {},
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; },
    send(v) { this.body = v; return this; },
    redirect(u) { this.redirected = u; return this; },
    render(view, data) { this.view = view; this.data = data; return this; },
  };
}
const reqFor = (body, params = { key: 'skin_analysis' }) => ({ body, params, query: {}, admin: { email: 'boss@example.com', csrf: 'c' } });
const goodBody = { guidance: 'g', timeoutSec: '60', maxOutputTokens: '1000', maxCostUsd: '0.10', note: 'n', sampleCase: 'en_basic' };
const liveConfig = { guidance: '', limits: { timeoutSec: 90, maxOutputTokens: 8000, maxCostUsd: 0.25 }, source: 'default' };

beforeEach(() => {
  jest.clearAllMocks();
  isBuiltInAdmin.mockReturnValue(true);
  aiConfig.getActiveConfig.mockResolvedValue(liveConfig);
  aiConfig.listVersions.mockResolvedValue([]);
});

describe('every POST has the CSRF check and the built-in gate', () => {
  test.each(['/:key', '/:key/restore', '/:key/test'])('%s', path => {
    const chain = chainFor(path);
    expect(chain).toContain(requireCsrf);
    // The gate is the middleware right after requireCsrf: a non built-in admin gets 403.
    const gate = chain[chain.indexOf(requireCsrf) + 1];
    isBuiltInAdmin.mockReturnValue(false);
    const res = fakeRes();
    const next = jest.fn();
    gate(reqFor({}), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    if (path.endsWith('/test')) expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe('publish', () => {
  test('invalid values: 400, field errors, nothing saved, no audit', async () => {
    const res = fakeRes();
    await handlerFor('/:key')(reqFor({ ...goodBody, timeoutSec: '5' }), res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(res.data.errors).toHaveProperty('timeoutSec');
    expect(res.data.form.timeoutSec).toBe('5');
    expect(aiConfig.saveVersion).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('unchanged: redirect with ai_unchanged and no audit', async () => {
    aiConfig.saveVersion.mockResolvedValue({ ok: true, changed: false });
    const res = fakeRes();
    await handlerFor('/:key')(reqFor(goodBody), res, jest.fn());
    expect(res.redirected).toBe('/admin/ai/skin_analysis?notice=ai_unchanged');
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('saved: audit ai_config_published and redirect with ai_published', async () => {
    aiConfig.saveVersion.mockResolvedValue({ ok: true, changed: true, version: {} });
    const req = reqFor(goodBody);
    const res = fakeRes();
    await handlerFor('/:key')(req, res, jest.fn());
    expect(aiConfig.saveVersion).toHaveBeenCalledWith('skin_analysis', expect.objectContaining({ timeoutSec: 60 }), 'boss@example.com');
    expect(logAdminAction).toHaveBeenCalledWith(req, 'ai_config_published', { fields: ['skin_analysis'] });
    expect(res.redirected).toBe('/admin/ai/skin_analysis?notice=ai_published');
  });
});

describe('restore', () => {
  test('unknown version: 404, no audit', async () => {
    aiConfig.restoreVersion.mockResolvedValue({ ok: false, code: 'not_found' });
    const res = fakeRes();
    await handlerFor('/:key/restore')(reqFor({ versionId: 'zzz' }), res, jest.fn());
    expect(res.statusCode).toBe(404);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('success: audit ai_config_restored and redirect', async () => {
    aiConfig.restoreVersion.mockResolvedValue({ ok: true, changed: true, version: {} });
    const req = reqFor({ versionId: 'default' });
    const res = fakeRes();
    await handlerFor('/:key/restore')(req, res, jest.fn());
    expect(logAdminAction).toHaveBeenCalledWith(req, 'ai_config_restored', { fields: ['skin_analysis'] });
    expect(res.redirected).toBe('/admin/ai/skin_analysis?notice=ai_restored');
  });
});

describe('test run', () => {
  test('invalid values: 400 with errors, no provider call', async () => {
    const res = fakeRes();
    await handlerFor('/:key/test')(reqFor({ ...goodBody, maxCostUsd: 0.9 }), res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toHaveProperty('maxCostUsd');
    expect(runTestCase).not.toHaveBeenCalled();
  });

  test('unknown sample case: 400', async () => {
    const res = fakeRes();
    await handlerFor('/:key/test')(reqFor({ ...goodBody, sampleCase: 'nope' }), res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(runTestCase).not.toHaveBeenCalled();
  });

  test('over the hourly limit: 429 and no provider call', async () => {
    consumeRateLimit.mockResolvedValue(false);
    const res = fakeRes();
    await handlerFor('/:key/test')(reqFor(goodBody), res, jest.fn());
    expect(consumeRateLimit).toHaveBeenCalledWith('admin_ai_test', 'boss@example.com', 20);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many test runs this hour.' });
    expect(runTestCase).not.toHaveBeenCalled();
  });

  test('BEDROCK_NOT_CONFIGURED: answered as-is and NOT audited', async () => {
    consumeRateLimit.mockResolvedValue(true);
    runTestCase.mockResolvedValue({ ok: false, code: 'BEDROCK_NOT_CONFIGURED' });
    const res = fakeRes();
    await handlerFor('/:key/test')(reqFor(goodBody), res, jest.fn());
    expect(res.body).toEqual({ ok: false, code: 'BEDROCK_NOT_CONFIGURED' });
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('a real attempt is audited as ai_config_tested', async () => {
    consumeRateLimit.mockResolvedValue(true);
    runTestCase.mockResolvedValue({ ok: true, durationMs: 5, costUsd: 0.1, validationErrors: [], summary: {} });
    const req = reqFor(goodBody);
    const res = fakeRes();
    await handlerFor('/:key/test')(req, res, jest.fn());
    expect(runTestCase).toHaveBeenCalledWith('skin_analysis', expect.objectContaining({ id: 'en_basic' }),
      { guidance: 'g', limits: { timeoutSec: 60, maxOutputTokens: 1000, maxCostUsd: 0.1 } });
    expect(logAdminAction).toHaveBeenCalledWith(req, 'ai_config_tested', { fields: ['skin_analysis'] });
    expect(res.body.ok).toBe(true);
  });
});

describe('pages', () => {
  test('unknown key on the edit page is a 404', () => {
    const knownKey = chainFor('/:key', 'get').find(h => h.name === 'knownKey');
    const res = fakeRes();
    knownKey(reqFor({}, { key: 'nope' }), res, jest.fn());
    expect(res.statusCode).toBe(404);
  });

  test('read-only admin: edit page renders with canEdit false and the forbidden notice', async () => {
    isBuiltInAdmin.mockReturnValue(false);
    const res = fakeRes();
    await handlerFor('/:key', 'get')(reqFor({}), res, jest.fn());
    expect(res.data.canEdit).toBe(false);
    expect(res.data.notice.text).toBe('Only built-in admins can change AI settings.');
  });
});
