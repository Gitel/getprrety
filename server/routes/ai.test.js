jest.mock('../middleware/auth', () => jest.fn((req, _res, next) => { req.user = req.user || { id: 'user-1' }; next(); }));
jest.mock('../services/rateLimit', () => ({ consumeRateLimit: jest.fn() }));
jest.mock('../services/bedrock/client', () => ({
  TIMEOUT_MS: 90_000,
  completeJson: jest.fn(),
  BedrockError: class BedrockError extends Error { constructor(code, status = 502) { super('Analysis provider failed'); this.code = code; this.status = status; } },
}));
jest.mock('../services/bedrock/catalogue', () => ({ loadCatalogue: jest.fn() }));

const router = require('./ai');
const { consumeRateLimit } = require('../services/rateLimit');
const { completeJson, BedrockError } = require('../services/bedrock/client');
const { loadCatalogue } = require('../services/bedrock/catalogue');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const validAnalysis = () => ({
  era: {
    era: { id: 'barrier_healing', affirmation: 'Gentle care is enough.' },
    skin_analysis: { summary: 'A gentle and consistent routine can support comfort.', key_insights: [] },
    routine: {
      am: [
        { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
        { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
        { category_id: 'protect', category: 'Sun protection', instruction: 'Apply sunscreen.' },
      ],
      pm: [
        { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
        { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
      ],
    },
    product_audit: { current_products_assessment: [], most_urgent_gap: null },
    check_in_prompts: [], safety_flags: ['Stop if irritation develops.'], event_prep: null,
  },
  srProducts: null,
  shelfAnalysis: null,
});

function routeHandler(path, method = 'post') {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function invoke(handler, body, user = null) {
  const req = { body, ip: '203.0.113.9', socket: {}, user: user || { id: 'user-1' } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler(req, res);
  return res;
}

async function invokeSse(handler, body) {
  const req = { body, ip: '203.0.113.9', socket: {}, headers: { accept: 'text/event-stream' } };
  const res = {
    statusCode: 200, headers: {}, chunks: [], writableEnded: false, destroyed: false,
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    flushHeaders() {},
    write(value) { this.chunks.push(value); return true; },
    end() { this.writableEnded = true; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler(req, res);
  return { ...res, events: res.chunks.filter(chunk => chunk.startsWith('event:')).map(chunk => {
    const [, event] = chunk.match(/^event: ([^\n]+)/);
    return { event, data: JSON.parse(chunk.match(/\ndata: ([^\n]+)/)[1]) };
  }) };
}

beforeEach(() => {
  process.env.JWT_SECRET = 'unit-test-hmac-secret';
  consumeRateLimit.mockReset().mockResolvedValue(true);
  completeJson.mockReset();
  loadCatalogue.mockReset().mockReturnValue([]);
});
afterAll(() => { delete process.env.JWT_SECRET; });

test('pre-signup analysis uses minimized inputs, validates the contract, and marks its source', async () => {
  completeJson.mockResolvedValue(validAnalysis());
  const res = await invoke(routeHandler('/analyze-skin'), {
    quizAnswers: { gender: 'she', skin_goals: ['dryness'], name: 'Private Name', email: 'private@example.test' },
    language: 'en', images: [
      { angle: 'front', mediaType: 'image/png', base64: PNG },
      { angle: 'shelf', mediaType: 'image/png', base64: PNG },
    ],
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ source: 'bedrock', era: { era: { id: 'barrier_healing' } } });
  expect(completeJson).toHaveBeenCalledTimes(1);
  const request = completeJson.mock.calls[0][0];
  expect(JSON.stringify(request.messages)).not.toMatch(/Private Name|private@example\.test/);
  expect(JSON.stringify(request.messages)).toContain('Photo angle: front.');
  expect(JSON.stringify(request.messages)).toContain('Photo angle: shelf.');
  expect(request.schema.required).toEqual(['era', 'srProducts', 'shelfAnalysis']);
  expect(consumeRateLimit).toHaveBeenNthCalledWith(1, 'analysis_ip', expect.any(String), expect.any(Number));
  expect(consumeRateLimit).toHaveBeenNthCalledWith(2, 'analysis_global', 'all', expect.any(Number));
});

test('rejects oversized or malformed photos before consuming paid-call budget', async () => {
  const handler = routeHandler('/analyze-skin');
  const oversized = await invoke(handler, {
    quizAnswers: {}, language: 'en', images: [{ angle: 'front', mediaType: 'image/jpeg', base64: 'A'.repeat(11_200_000) }],
  });
  expect(oversized.statusCode).toBe(400);
  const wrongAngle = await invoke(handler, {
    quizAnswers: {}, language: 'en', images: [{ angle: 'sideways', mediaType: 'image/jpeg', base64: 'AA==' }],
  });
  expect(wrongAngle.statusCode).toBe(400);
  expect(consumeRateLimit).not.toHaveBeenCalled();
  expect(completeJson).not.toHaveBeenCalled();
});

test('rejects oversized whitelisted quiz values before provider calls', async () => {
  const res = await invoke(routeHandler('/analyze-skin'), {
    quizAnswers: { skin_goals: ['x'.repeat(40_000)] }, language: 'en', images: [],
  });
  expect(res.statusCode).toBe(400);
  expect(consumeRateLimit).not.toHaveBeenCalled();
  expect(completeJson).not.toHaveBeenCalled();
});

test('applies the per-IP and global budgets before provider calls', async () => {
  consumeRateLimit.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const res = await invoke(routeHandler('/analyze-skin'), { quizAnswers: {}, language: 'en', images: [] });
  expect(res.statusCode).toBe(429);
  expect(completeJson).not.toHaveBeenCalled();
});

test('fails closed when generated analysis violates semantic contract checks', async () => {
  const invalid = validAnalysis();
  invalid.era.routine.am.pop();
  completeJson.mockResolvedValue(invalid);
  const res = await invoke(routeHandler('/analyze-skin'), { quizAnswers: {}, language: 'en', images: [] });
  expect(res.statusCode).toBe(502);
  expect(res.body).toEqual({ error: 'Analysis provider failed' });
});

test('SSE analysis sends only progress before full semantic validation and returns a typed completion', async () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  completeJson.mockImplementation(async options => {
    expect(options.stream).toBe(true);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.timeoutMs).toBeLessThanOrEqual(84_000);
    options.onEvent({ phase: 'first_content', elapsedMs: 3, contentBytes: 12, rawContent: 'private provider text' });
    return validAnalysis();
  });
  const res = await invokeSse(routeHandler('/analyze-skin'), {
    quizAnswers: { name: 'Private Person', email: 'private@example.test' }, language: 'en', images: [],
  });
  const records = log.mock.calls.map(([channel, json]) => ({ channel, ...JSON.parse(json) }));
  const setup = records.filter(record => record.channel === 'analysis-setup');
  expect(setup.map(record => record.phase)).toEqual([
    'ingress', 'parsed', 'budget_start', 'budget_complete', 'catalogue_loaded', 'prompt_ready', 'provider_start', 'semantic_validated',
  ]);
  expect(new Set(setup.map(record => record.requestId)).size).toBe(1);
  expect(setup.every(record => Object.keys(record).every(key => [
    'channel', 'requestId', 'phase', 'elapsedMs', 'status', 'imageCount', 'quizBytes', 'catalogueCount', 'messageCount', 'code',
  ].includes(key)))).toBe(true);
  expect(records.find(record => record.channel === 'analysis-provider')).toHaveProperty('providerElapsedMs');
  expect(JSON.stringify(records)).not.toMatch(/private provider text|Private Person|private@example\.test/);
  log.mockRestore();
  expect(res.statusCode).toBe(200);
  expect(res.headers).toMatchObject({ 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' });
  expect(res.events.map(event => event.event)).toEqual(['progress', 'progress', 'progress', 'complete']);
  expect(res.events.slice(0, 3).map(event => event.data.phase)).toEqual(['waiting', 'generating', 'validating']);
  expect(res.events[3].data.analysis).toMatchObject({ source: 'bedrock', era: { era: { id: 'barrier_healing' } } });
});

test('SSE analysis rejects semantically invalid output without emitting a completion payload', async () => {
  const invalid = validAnalysis();
  invalid.era.routine.am.pop();
  completeJson.mockResolvedValue(invalid);
  const res = await invokeSse(routeHandler('/analyze-skin'), { quizAnswers: {}, language: 'en', images: [] });
  expect(res.events.at(-1)).toMatchObject({
    event: 'error', data: { error: 'Analysis provider failed', status: 502, code: 'BEDROCK_CONTRACT_INVALID' },
  });
  expect(res.events.some(event => event.event === 'complete')).toBe(false);
  expect(JSON.stringify(res.events)).not.toContain('barrier_healing');
});

test('returns a safe service-unavailable response when Bedrock is not configured', async () => {
  completeJson.mockRejectedValue(new BedrockError('BEDROCK_NOT_CONFIGURED', 503));
  const res = await invoke(routeHandler('/analyze-skin'), { quizAnswers: {}, language: 'en', images: [] });
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ error: 'Analysis is unavailable' });
});

test('market recommendations forward sanitized safety context and preserve the public response shape', async () => {
  completeJson.mockResolvedValue({ add: [{ index: 0, rec: { brand: 'Example', name: 'Gentle Cream', price: '$10', retailer: 'Shop', url: 'javascript:alert(1)' } }], replace: [] });
  const res = await invoke(routeHandler('/product-recommendations'), {
    productAudit: { add: [{ product: 'moisturizer' }], replace: [] }, country: 'US', eraName: 'Barrier',
    quizAnswers: { allergies: ['none'], irritants: ['nothing'], pregnancy_caution: false, ahas_bhas: false, name: 'Private Name' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ add: [{ index: 0, rec: { brand: 'Example', name: 'Gentle Cream', price: '$10', retailer: 'Shop', url: '' } }], replace: [] });
  const requestText = completeJson.mock.calls[0][0].messages[0].content;
  expect(() => new (require('ajv'))({ strict: true, allowUnionTypes: true }).compile(completeJson.mock.calls[0][0].schema)).not.toThrow();
  expect(requestText).toContain('"allergies":[]');
  expect(requestText).toContain('pregnancyCaution');
  expect(requestText).not.toContain('Private Name');
});

test('market recommendations with pregnancy or ingredient restrictions fail closed without unverified catalogue data', async () => {
  const res = await invoke(routeHandler('/product-recommendations'), {
    productAudit: { add: [{ product: 'moisturizer' }] },
    quizAnswers: { allergies: ['fragrance'], pregnancy_caution: true },
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ add: [], replace: [] });
  expect(completeJson).not.toHaveBeenCalled();
});

test('market recommendations fail closed when answers are missing, empty, invalid, or an unknown irritant is reported', async () => {
  const oldClient = await invoke(routeHandler('/product-recommendations'), {
    productAudit: { add: [{ product: 'moisturizer' }] },
  });
  expect(oldClient.body).toEqual({ add: [], replace: [] });
  expect(completeJson).not.toHaveBeenCalled();

  const unknownIrritant = await invoke(routeHandler('/product-recommendations'), {
    productAudit: { add: [{ product: 'moisturizer' }] },
    safetyContext: { pregnant_or_ttc: 'no', allergies: ['none'], irritants: ['peppermint'] },
  });
  expect(unknownIrritant.body).toEqual({ add: [], replace: [] });
  expect(completeJson).not.toHaveBeenCalled();

  for (const context of [
    { pregnant_or_ttc: 'yes please', allergies: ['none'], irritants: ['nothing'] },
    { pregnant_or_ttc: 'no', allergies: [], irritants: ['nothing'] },
    { pregnant_or_ttc: 'no', allergies: ['none'], irritants: [] },
    { pregnant_or_ttc: 'no', allergies: ['  '], irritants: ['nothing'] },
    { pregnant_or_ttc: 'no', allergies: ['none'], irritants: ['\t'] },
  ]) {
    const invalid = await invoke(routeHandler('/product-recommendations'), {
      productAudit: { add: [{ product: 'moisturizer' }] }, safetyContext: context,
    });
    expect(invalid.body).toEqual({ add: [], replace: [] });
  }
  expect(completeJson).not.toHaveBeenCalled();
});

test('recommendations retain the existing provider-failure response', async () => {
  completeJson.mockRejectedValue(new BedrockError('BEDROCK_HTTP_503', 502));
  const res = await invoke(routeHandler('/product-recommendations'), {
    productAudit: { add: [{ product: 'cleanser' }] }, country: 'US',
    safetyContext: { pregnant_or_ttc: 'no', allergies: ['none'], irritants: ['nothing'] },
  });
  expect(res.statusCode).toBe(502);
  expect(res.body).toEqual({ error: 'Recommendation service failed' });
});
