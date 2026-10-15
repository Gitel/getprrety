jest.mock('../middleware/auth', () => jest.fn((req, _res, next) => { req.user = { id: 'user-1' }; next(); }));
jest.mock('../models/CatalogueProduct', () => ({ find: jest.fn(), findById: jest.fn() }));

const requireAuth = require('../middleware/auth');
const CatalogueProduct = require('../models/CatalogueProduct');
const router = require('./catalogue');

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const UPDATED = new Date('2026-10-01T10:00:00Z');

// The route for a path; its stack is [middlewares..., handler].
function layer(path) {
  return router.stack.find(item => item.route?.path === path && item.route.methods.get).route;
}
const handler = path => layer(path).stack[layer(path).stack.length - 1].handle;

function fakeRes() {
  const res = { headers: {}, statusCode: 200 };
  res.status = jest.fn(code => { res.statusCode = code; return res; });
  res.json = jest.fn(body => { res.body = body; return res; });
  res.send = jest.fn(body => { res.body = body; return res; });
  res.end = jest.fn(() => res);
  res.set = jest.fn((k, v) => { res.headers[k] = v; return res; });
  return res;
}

// CatalogueProduct.find(...).select(...).lean() resolves docs.
const mockFind = docs => CatalogueProduct.find.mockReturnValue({ select: () => ({ lean: async () => docs }) });
// findById is called twice for a photo: metadata first, then (service) the bytes document.
function mockFindById(meta, photoDoc) {
  CatalogueProduct.findById
    .mockReturnValueOnce({ select: () => ({ lean: async () => meta }) })
    .mockReturnValueOnce({ select: () => ({ lean: async () => photoDoc }) });
}

beforeEach(() => jest.resetAllMocks());

describe('GET /products', () => {
  const run = async ids => {
    const res = fakeRes();
    await handler('/products')({ query: { ids } }, res, jest.fn());
    return res;
  };
  const twenty = Array.from({ length: 20 }, (_, i) => String(i).padStart(24, '0'));

  test('is protected by the user auth middleware', () => {
    expect(layer('/products').stack.some(l => l.handle === requireAuth)).toBe(true);
  });

  test.each([
    undefined, '', ['x'], 'nothex', `${A},zzz`, `${A},${'g'.repeat(24)}`, [...twenty, A].join(','),
  ])('rejects ids %p with 400 INVALID_IDS', async ids => {
    const res = await run(ids);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_IDS' });
    expect(CatalogueProduct.find).not.toHaveBeenCalled();
  });

  test('accepts exactly 20 ids', async () => {
    mockFind([]);
    expect((await run(twenty.join(','))).body).toEqual({ products: [] });
  });

  test('dedupes ids, keeps request order, omits unknown ids', async () => {
    mockFind([
      { _id: A, name: 'A', updatedAt: UPDATED },
      { _id: B, name: 'B', updatedAt: UPDATED },
    ]);
    const res = await run(`${B},${C},${A},${B}`);
    expect(CatalogueProduct.find.mock.calls[0][0]).toEqual({ _id: { $in: [B, C, A] } });
    expect(res.body.products.map(p => p.id)).toEqual([B, A]);
  });

  test('returns the contract fields only; archived included; no ingredients or photo bytes', async () => {
    mockFind([{
      _id: A, name: 'Zit Out', category: 'face_serums', keyActives: ['BHA'], price: 129.9,
      shopUrl: 'https://s.test/z', archived: true, updatedAt: UPDATED,
      photo: { size: 5, data: JPEG }, ingredients: 'secret', strengths: ['x'], seedKey: 'k',
    }]);
    const [p] = (await run(A)).body.products;
    expect(p).toEqual({
      id: A, name: 'Zit Out', category: 'face_serums', keyActives: ['BHA'], price: 129.9,
      shopUrl: 'https://s.test/z', hasPhoto: true, photoVersion: UPDATED.getTime(), archived: true,
    });
  });

  test('missing price / link / photo become null / false', async () => {
    mockFind([{ _id: A, name: 'Plain', updatedAt: UPDATED }]);
    const [p] = (await run(A)).body.products;
    expect(p).toMatchObject({ price: null, shopUrl: null, hasPhoto: false, archived: false, keyActives: [] });
  });

  test('never selects ingredients or photo bytes from the database', async () => {
    const select = jest.fn(() => ({ lean: async () => [] }));
    CatalogueProduct.find.mockReturnValue({ select });
    await run(A);
    const fields = select.mock.calls[0][0];
    expect(fields).not.toMatch(/ingredients|photo\.data|strengths|seedKey/);
    expect(fields).toContain('photo.size');
  });
});

describe('GET /products/:id/photo', () => {
  const run = async (id, query = {}, headers = {}) => {
    const res = fakeRes();
    await handler('/products/:id/photo')({ params: { id }, query, headers }, res, jest.fn());
    return res;
  };
  const etag = `"${A}-${UPDATED.getTime()}"`;
  const withPhoto = () => mockFindById(
    { updatedAt: UPDATED, photo: { size: 5 } },
    { photo: { data: JPEG, mimeType: 'image/png' } },
  );

  test('is public: only the handler is on the route (no auth middleware)', () => {
    expect(layer('/products/:id/photo').stack).toHaveLength(1);
  });

  test('404 for an invalid id without touching the database', async () => {
    expect((await run('nope')).statusCode).toBe(404);
    expect(CatalogueProduct.findById).not.toHaveBeenCalled();
  });

  test('404 for an unknown product', async () => {
    mockFindById(null, null);
    expect((await run(A)).statusCode).toBe(404);
  });

  test('404 for a product without a photo', async () => {
    mockFindById({ updatedAt: UPDATED, photo: {} }, null);
    expect((await run(A)).statusCode).toBe(404);
  });

  test('with ?v= it is cached for a year (immutable) and carries the other headers', async () => {
    withPhoto();
    const res = await run(A, { v: '123' });
    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers.ETag).toBe(etag);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    expect(res.send).toHaveBeenCalledWith(JPEG);
  });

  test('without ?v= it is cached for 5 minutes', async () => {
    withPhoto();
    expect((await run(A)).headers['Cache-Control']).toBe('public, max-age=300');
  });

  test('304 when If-None-Match matches, and the bytes are not loaded', async () => {
    mockFindById({ updatedAt: UPDATED, photo: { size: 5 } }, null);
    const res = await run(A, {}, { 'if-none-match': etag });
    expect(res.statusCode).toBe(304);
    expect(res.send).not.toHaveBeenCalled();
    expect(CatalogueProduct.findById).toHaveBeenCalledTimes(1);
  });

  test('a different ETag still gets the photo', async () => {
    withPhoto();
    expect((await run(A, {}, { 'if-none-match': '"old"' })).statusCode).toBe(200);
  });
});
