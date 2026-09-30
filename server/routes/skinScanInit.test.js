// POST /api/skin-scan/init: the optional `language` field is stored as 'he' only when it is exactly
// 'he'; anything else is 'en' and must never fail the scan. Models, vendor client and budget are mocked.
jest.mock('../models/SkinScan');
jest.mock('../middleware/auth', () => (_req, _res, next) => next());
jest.mock('../services/perfectcorp/client');
jest.mock('../jobs/skinScanPoller', () => ({}));
jest.mock('../services/anonymousScanBudget', () => ({ enforceAnonymousScanBudget: jest.fn().mockResolvedValue() }));

const SkinScan = require('../models/SkinScan');
const client = require('../services/perfectcorp/client');
const router = require('./skinScan');

// 1x1 PNG, small enough to pass the decoder and size checks.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function init(body) {
  const layer = router.stack.find(l => l.route && l.route.path === '/init' && l.route.methods.post);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const req = { body, headers: {}, ip: '1.2.3.4', connection: {} };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
}

describe('scan init language', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    SkinScan.create.mockResolvedValue({ _id: 'scan1' });
    SkinScan.updateOne.mockResolvedValue({});
    SkinScan.deleteOne.mockResolvedValue({});
    client.requestFileSlots.mockResolvedValue([{ url: 'https://u', file_id: 'f1', headers: {} }]);
    client.putToPresignedUrl.mockResolvedValue();
  });
  afterEach(() => jest.clearAllMocks());

  const photos = [{ angle: 'front', base64: PNG, contentType: 'image/png' }];

  test.each([
    ['he', 'he'], [' HE ', 'he'], ['en', 'en'], ['fr', 'en'], [undefined, 'en'], [5, 'en'], [{ x: 1 }, 'en'], ['', 'en'],
  ])('language %p is stored as %p and the scan still succeeds', async (input, stored) => {
    const res = await init({ photos, quizAnswers: {}, language: input });
    expect(res.statusCode).toBe(201);
    expect(SkinScan.create).toHaveBeenCalledWith(expect.objectContaining({ language: stored }));
  });
});
