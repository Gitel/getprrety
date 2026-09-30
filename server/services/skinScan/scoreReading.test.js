jest.mock('../../models/SkinScan', () => ({ findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));

const SkinScan = require('../../models/SkinScan');
const {
  buildReadingRequest, sanitizeReading, readingStatusFor, maybeRequestReading, STALE_PENDING_MS,
} = require('./scoreReading');
const { scanView } = require('./scanView');

const merged = {
  concerns: {
    moisture: { raw: 48.94 }, oiliness: { raw: 63.45 },
    pore: { raw: 52.34 }, texture: { raw: 88.17 }, acne: { raw: 93.98 },
    radiance: { raw: 76.8 }, redness: { raw: 68.27 }, age_spot: { raw: 71.4 },
    wrinkle: { raw: 74.79 }, firmness: { raw: 85.12 },
  },
  overall: { raw: 75.93 },
  skinAge: 37,
  skinType: { whole: 'Combination' },
};
// Today's signal scores for this scan: barrier 56, clarity 78, tone 72, resilience 80.
const SIGNALS = [
  { key: 'barrier', score: 56 }, { key: 'clarity', score: 78 }, { key: 'tone', score: 72 }, { key: 'resilience', score: 80 },
];

const goodBody = () => ({
  start_here: { title: 'Wear SPF every morning', body: 'One habit moves the most at once.' },
  signals: [{
    key: 'barrier', potential: 66, weeks: '6-8 weeks',
    driver: 'Hydration reads low.', why: 'No moisturiser in your routine.', lever: 'A ceramide moisturiser.',
    shelf: { status: 'missing', text: 'No moisturiser on your shelf.' },
    product: { name: 'SR Barrier Repair Cream', actives: 'Ceramides', url: 'https://shop.example/cream' },
    extra: 'ignored',
  }],
});

describe('sanitizeReading', () => {
  test('keeps a valid reading in the app shape (camelCase, unknown keys dropped)', () => {
    expect(sanitizeReading(goodBody(), SIGNALS)).toEqual({
      startHere: { title: 'Wear SPF every morning', body: 'One habit moves the most at once.' },
      signals: [{
        key: 'barrier', potential: 66, weeks: '6-8 weeks',
        driver: 'Hydration reads low.', why: 'No moisturiser in your routine.', lever: 'A ceramide moisturiser.',
        shelf: { status: 'missing', text: 'No moisturiser on your shelf.' },
        product: { name: 'SR Barrier Repair Cream', actives: 'Ceramides', url: 'https://shop.example/cream' },
      }],
    });
  });

  test('trims and caps long text', () => {
    const body = goodBody();
    body.start_here.title = `  ${'T'.repeat(200)}  `;
    body.signals[0].driver = 'D'.repeat(1000);
    const reading = sanitizeReading(body, SIGNALS);
    expect(reading.startHere.title).toHaveLength(80);
    expect(reading.signals[0].driver).toHaveLength(400);
  });

  test.each([
    ['below today\'s score', 50],
    ['above 100', 101],
    ['not an integer', 66.5],
    ['a string', '66'],
  ])('drops a potential that is %s', (_, potential) => {
    const body = goodBody();
    body.signals[0].potential = potential;
    expect(sanitizeReading(body, SIGNALS).signals[0].potential).toBeNull();
  });

  test('drops the potential when the signal has no score today', () => {
    expect(sanitizeReading(goodBody(), [{ key: 'barrier', score: null }]).signals[0].potential).toBeNull();
  });

  test.each([
    'http://shop.example/cream', 'javascript:alert(1)', 'data:text/html,hi', 'not a url', 42,
  ])('only https product links survive (%s -> null)', url => {
    const body = goodBody();
    body.signals[0].product.url = url;
    expect(sanitizeReading(body, SIGNALS).signals[0].product).toMatchObject({ name: 'SR Barrier Repair Cream', url: null });
  });

  test('a product without a name and a shelf line with an unknown status are dropped', () => {
    const body = goodBody();
    body.signals[0].product = { actives: 'x', url: 'https://a.example' };
    body.signals[0].shelf = { status: 'maybe', text: 'x' };
    const signal = sanitizeReading(body, SIGNALS).signals[0];
    expect(signal.product).toBeNull();
    expect(signal.shelf).toBeNull();
  });

  test('unknown or duplicate signal keys and empty entries are dropped one by one', () => {
    const body = goodBody();
    body.signals.push({ key: 'glow', driver: 'x' }, { key: 'barrier', driver: 'second copy' }, { key: 'tone' }, null);
    const reading = sanitizeReading(body, SIGNALS);
    expect(reading.signals.map(s => s.key)).toEqual(['barrier']);
    expect(reading.signals[0].driver).toBe('Hydration reads low.');
  });

  test('"Start here" needs both a title and a body', () => {
    const body = goodBody();
    delete body.start_here.body;
    expect(sanitizeReading(body, SIGNALS).startHere).toBeNull();
  });

  test('nothing usable -> null', () => {
    expect(sanitizeReading({ signals: [{ key: 'glow' }] }, SIGNALS)).toBeNull();
    expect(sanitizeReading({}, SIGNALS)).toBeNull();
    expect(sanitizeReading(null, SIGNALS)).toBeNull();
    expect(sanitizeReading('<b>hi</b>', SIGNALS)).toBeNull();
  });
});

describe('buildReadingRequest', () => {
  test('sends the stored quiz answers and the scores - nothing else from the scan', () => {
    const scan = {
      _id: 's1', merged, quizSnapshot: { routine_products: ['cleanser'], pregnancy_caution: false },
      accessTokenHash: 'secret', requestIpHash: 'ip', userId: 'u1',
    };
    const body = buildReadingRequest(scan);
    expect(Object.keys(body)).toEqual(['quizAnswers', 'language', 'scan']);
    expect(body.quizAnswers).toEqual({ routine_products: ['cleanser'], pregnancy_caution: false });
    expect(body.scan).toMatchObject({ overall: 76, skinAge: 37, skinType: { whole: 'Combination' } });
    expect(body.scan.signals.map(s => [s.key, s.score])).toEqual([['barrier', 56], ['clarity', 78], ['tone', 72], ['resilience', 80]]);
    expect(JSON.stringify(body)).not.toMatch(/secret|"ip"|u1/);
  });

  test('sends the scan language; an old scan without the field sends en', () => {
    expect(buildReadingRequest({ merged, quizSnapshot: null, language: 'he' }).language).toBe('he');
    expect(buildReadingRequest({ merged, quizSnapshot: null }).language).toBe('en');
  });

  test('signals without a score are left out', () => {
    const body = buildReadingRequest({ merged: { concerns: { moisture: { raw: 50 } } }, quizSnapshot: null });
    expect(body.quizAnswers).toEqual({});
    expect(body.scan.signals.map(s => s.key)).toEqual(['barrier']);
  });
});

describe('readingStatusFor / scanView', () => {
  const OLD_ENV = process.env.RAILWAY_API_URL;
  afterEach(() => { process.env.RAILWAY_API_URL = OLD_ENV; });

  test('final states pass through; otherwise pending, or unavailable when the feature is off', () => {
    process.env.RAILWAY_API_URL = 'https://railway.example';
    expect(readingStatusFor({ readingStatus: 'ready' })).toBe('ready');
    expect(readingStatusFor({ readingStatus: 'failed' })).toBe('failed');
    expect(readingStatusFor({ readingStatus: null })).toBe('pending');
    expect(readingStatusFor({ readingStatus: 'pending' })).toBe('pending');
    delete process.env.RAILWAY_API_URL;
    expect(readingStatusFor({ readingStatus: null })).toBe('unavailable');
    expect(readingStatusFor({ readingStatus: 'ready' })).toBe('ready');
  });

  test('scanView only exposes the reading once it is ready', () => {
    process.env.RAILWAY_API_URL = 'https://railway.example';
    const reading = { startHere: null, signals: [] };
    expect(scanView({ merged, readingStatus: 'ready', reading })).toMatchObject({ reading, readingStatus: 'ready' });
    expect(scanView({ merged, readingStatus: 'pending', reading })).toMatchObject({ reading: null, readingStatus: 'pending' });
    expect(scanView({ merged }).signals.overall).toBe(76);
  });
});

describe('maybeRequestReading', () => {
  const NOW = Date.parse('2026-09-27T12:00:00Z');
  const OLD_ENV = process.env.RAILWAY_API_URL;
  const completeScan = (extra = {}) => ({ _id: 'scan1', status: 'complete', merged, quizSnapshot: { water_intake: 'less_1l' }, ...extra });
  const okResponse = body => ({ ok: true, status: 200, json: async () => body });

  beforeEach(() => {
    process.env.RAILWAY_API_URL = 'https://railway.example/';
    SkinScan.findOneAndUpdate.mockReset();
    SkinScan.updateOne.mockReset().mockResolvedValue({});
    global.fetch = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.RAILWAY_API_URL = OLD_ENV;
    delete global.fetch;
    console.warn.mockRestore();
  });

  test('feature off, scan not complete, or already final -> no DB write, no call', async () => {
    delete process.env.RAILWAY_API_URL;
    expect(await maybeRequestReading(completeScan(), NOW)).toBe(false);
    process.env.RAILWAY_API_URL = 'https://railway.example';
    expect(await maybeRequestReading(completeScan({ status: 'processing' }), NOW)).toBe(false);
    expect(await maybeRequestReading(completeScan({ readingStatus: 'ready' }), NOW)).toBe(false);
    expect(await maybeRequestReading(completeScan({ readingStatus: 'failed' }), NOW)).toBe(false);
    expect(SkinScan.findOneAndUpdate).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a fresh pending claim is left alone (another request is in flight)', async () => {
    const scan = completeScan({ readingStatus: 'pending', readingRequestedAt: new Date(NOW - 10000) });
    expect(await maybeRequestReading(scan, NOW)).toBe(false);
    expect(SkinScan.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('losing the atomic claim to a concurrent poll makes no Railway call', async () => {
    SkinScan.findOneAndUpdate.mockResolvedValue(null);
    expect(await maybeRequestReading(completeScan(), NOW)).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('claims, calls /score-reading once and stores the sanitized reading as ready', async () => {
    const requestedAt = new Date(NOW);
    SkinScan.findOneAndUpdate.mockResolvedValue({ ...completeScan(), readingStatus: 'pending', readingRequestedAt: requestedAt });
    global.fetch.mockResolvedValue(okResponse(goodBody()));

    expect(await maybeRequestReading(completeScan(), NOW)).toBe(true);

    const [filter, update] = SkinScan.findOneAndUpdate.mock.calls[0];
    expect(filter.$or).toEqual([
      { readingStatus: null },
      { readingStatus: 'pending', readingRequestedAt: { $lt: new Date(NOW - STALE_PENDING_MS) } },
    ]);
    expect(update).toEqual({ $set: { readingStatus: 'pending', readingRequestedAt: requestedAt } });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://railway.example/score-reading');
    expect(JSON.parse(init.body).quizAnswers).toEqual({ water_intake: 'less_1l' });

    const [writeFilter, write] = SkinScan.updateOne.mock.calls[0];
    expect(writeFilter).toEqual({ _id: 'scan1', readingStatus: 'pending', readingRequestedAt: requestedAt });
    expect(write.$set.readingStatus).toBe('ready');
    expect(write.$set.reading.startHere.title).toBe('Wear SPF every morning');
  });

  test('a stale pending claim (server restart) is taken over', async () => {
    const scan = completeScan({ readingStatus: 'pending', readingRequestedAt: new Date(NOW - STALE_PENDING_MS - 1) });
    SkinScan.findOneAndUpdate.mockResolvedValue({ ...scan, readingRequestedAt: new Date(NOW) });
    global.fetch.mockResolvedValue(okResponse(goodBody()));
    expect(await maybeRequestReading(scan, NOW)).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a non-2xx answer', () => global.fetch.mockResolvedValue({ ok: false, status: 404 })],
    ['a body with nothing usable', () => global.fetch.mockResolvedValue(okResponse({ signals: [] }))],
    ['a network error / timeout', () => global.fetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
  ])('%s is stored as failed (final) without throwing', async (_, arrange) => {
    SkinScan.findOneAndUpdate.mockResolvedValue({ ...completeScan(), readingRequestedAt: new Date(NOW) });
    arrange();
    await expect(maybeRequestReading(completeScan(), NOW)).resolves.toBe(true);
    expect(SkinScan.updateOne.mock.calls[0][1]).toEqual({ $set: { readingStatus: 'failed' } });
  });
});
