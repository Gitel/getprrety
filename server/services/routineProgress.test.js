jest.mock('../models/RoutineProgress');
// Auth is covered elsewhere; here every request is user u1.
jest.mock('../middleware/auth', () => (req, _res, next) => { req.user = { id: 'u1' }; next(); });

const RoutineProgress = require('../models/RoutineProgress');
const router = require('../routes/routineProgress');
const { cleanProgressInput, isCalendarDay } = router;

// Calls the final handler of a route directly (no HTTP server in this test suite).
async function call(method, { query = {}, body = {} } = {}) {
  const layer = router.stack.find(l => l.route && l.route.methods[method]);
  const handlers = layer.route.stack.map(s => s.handle);
  const req = { query, body, user: { id: 'u1' } };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  await handlers[handlers.length - 1](req, res);
  return res;
}

describe('routine progress handlers', () => {
  afterEach(() => jest.clearAllMocks());

  test('PUT upserts the day for this user and returns it', async () => {
    RoutineProgress.findOneAndUpdate.mockResolvedValue({ date: '2026-09-23', routineKey: 'k', am: [0], pm: [] });
    const res = await call('put', { body: { date: '2026-09-23', routineKey: 'k', am: [0] } });
    expect(res.statusCode).toBe(200);
    expect(res.body.progress).toEqual({ date: '2026-09-23', routineKey: 'k', am: [0], pm: [] });
    expect(RoutineProgress.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'u1', date: '2026-09-23' },
      { routineKey: 'k', am: [0], pm: [] },
      expect.objectContaining({ upsert: true }),
    );
  });

  test('PUT retries once when two first writes of the day race on the unique index', async () => {
    RoutineProgress.findOneAndUpdate
      .mockRejectedValueOnce(Object.assign(new Error('E11000'), { code: 11000 }))
      .mockResolvedValueOnce({ date: '2026-09-23', routineKey: '', am: [], pm: [1] });
    const res = await call('put', { body: { date: '2026-09-23', pm: [1] } });
    expect(res.statusCode).toBe(200);
    expect(RoutineProgress.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  test('PUT rejects an invalid body without touching the DB', async () => {
    const res = await call('put', { body: { date: 'today', am: [0] } });
    expect(res.statusCode).toBe(400);
    expect(RoutineProgress.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('GET returns null when nothing was ticked that day, 400 on a bad date', async () => {
    RoutineProgress.findOne.mockResolvedValue(null);
    expect((await call('get', { query: { date: '2026-09-23' } })).body).toEqual({ progress: null });
    expect((await call('get', { query: { date: 'x' } })).statusCode).toBe(400);
  });
});

describe('isCalendarDay', () => {
  test('accepts real YYYY-MM-DD days, including leap days', () => {
    expect(isCalendarDay('2026-09-23')).toBe(true);
    expect(isCalendarDay('2028-02-29')).toBe(true);
  });

  test('rejects impossible or malformed days', () => {
    expect(isCalendarDay('2026-02-31')).toBe(false);
    expect(isCalendarDay('2026-9-23')).toBe(false);
    expect(isCalendarDay('23/09/2026')).toBe(false);
    expect(isCalendarDay(undefined)).toBe(false);
  });
});

describe('cleanProgressInput', () => {
  test('keeps a valid body, de-duplicating and sorting indices', () => {
    expect(cleanProgressInput({ date: '2026-09-23', routineKey: 'abc', am: [2, 0, 2], pm: [] }))
      .toEqual({ date: '2026-09-23', routineKey: 'abc', am: [0, 2], pm: [] });
  });

  test('missing lists mean nothing ticked; missing key becomes empty', () => {
    expect(cleanProgressInput({ date: '2026-09-23' }))
      .toEqual({ date: '2026-09-23', routineKey: '', am: [], pm: [] });
  });

  test('caps a long routineKey', () => {
    expect(cleanProgressInput({ date: '2026-09-23', routineKey: 'k'.repeat(500) }).routineKey).toHaveLength(100);
  });

  test.each([
    ['bad date', { date: '2026-02-31' }],
    ['negative index', { date: '2026-09-23', am: [-1] }],
    ['fractional index', { date: '2026-09-23', pm: [1.5] }],
    ['index out of range', { date: '2026-09-23', am: [50] }],
    ['non-array list', { date: '2026-09-23', am: '0,1' }],
    ['too many entries', { date: '2026-09-23', am: Array.from({ length: 51 }, () => 0) }],
    ['no body', undefined],
  ])('rejects %s', (_label, body) => {
    expect(cleanProgressInput(body)).toBeNull();
  });
});
