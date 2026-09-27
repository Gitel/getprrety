import { loadSession } from './loadSession';

jest.mock('./auth');
jest.mock('./api', () => ({ api: { get: jest.fn() } }));

const { getToken, removeToken } = require('./auth');
const { api } = require('./api');

const SAVED = { eraId: 'glow_building', routine: { am: [], pm: [] } };

// Resolves `value` after `ms` - lets a test make /analysis/latest slower than /me,
// which is exactly the ordering that used to drop the analysis.
const later = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));

function routeGet({ me, latest }) {
  api.get.mockImplementation(path => (path === '/api/auth/me' ? me() : latest()));
}

beforeEach(() => {
  jest.clearAllMocks();
  getToken.mockResolvedValue('test-token');
});

test('waits for the saved analysis even when it arrives after /me (the cold-start race)', async () => {
  routeGet({
    me: () => later(5, { user: { id: 'u1' } }),
    latest: () => later(30, { analysis: SAVED }),
  });

  await expect(loadSession({ timeoutMs: 1000 })).resolves.toEqual({ user: { id: 'u1' }, analysis: SAVED });
});

test('requests both in parallel, not one after the other', async () => {
  routeGet({ me: () => later(5, { user: { id: 'u1' } }), latest: () => later(5, { analysis: SAVED }) });

  const pending = loadSession({ timeoutMs: 1000 });
  await Promise.resolve(); await Promise.resolve(); // let getToken resolve and both calls start
  expect(api.get.mock.calls.map(c => c[0]).sort()).toEqual(['/api/analysis/latest', '/api/auth/me']);
  await pending;
});

test('a user without an analysis (404) still signs in, with analysis null', async () => {
  const notFound = Object.assign(new Error('No analysis found'), { status: 404 });
  routeGet({ me: async () => ({ user: { id: 'u1' } }), latest: async () => { throw notFound; } });

  await expect(loadSession({ timeoutMs: 1000 })).resolves.toEqual({ user: { id: 'u1' }, analysis: null });
  expect(removeToken).not.toHaveBeenCalled();
});

test('an invalid token is removed and nobody is signed in', async () => {
  const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 });
  routeGet({ me: async () => { throw unauthorized; }, latest: async () => { throw unauthorized; } });

  await expect(loadSession({ timeoutMs: 1000 })).resolves.toEqual({ user: null, analysis: null });
  expect(removeToken).toHaveBeenCalledTimes(1);
});

test('an offline start keeps the token for the next launch', async () => {
  const offline = Object.assign(new Error('Request timed out'), { status: 408 });
  routeGet({ me: async () => { throw offline; }, latest: async () => { throw offline; } });

  await expect(loadSession({ timeoutMs: 1000 })).resolves.toEqual({ user: null, analysis: null });
  expect(removeToken).not.toHaveBeenCalled();
});

test('no stored token: no requests at all', async () => {
  getToken.mockResolvedValue(null);

  await expect(loadSession({ timeoutMs: 1000 })).resolves.toEqual({ user: null, analysis: null });
  expect(api.get).not.toHaveBeenCalled();
});
