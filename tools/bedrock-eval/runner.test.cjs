const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const {
  BASE_URL,
  MAX_ATTEMPTS,
  MODEL,
  PRICING,
  calculateCost,
  loadCaseImages,
  readCatalogue,
  runEvaluations,
} = require('./runner.cjs');
const { isSuccessfulReport, numberOption } = require('./run.cjs');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const schema = {
  type: 'object',
  required: ['eraId'],
  additionalProperties: false,
  properties: { eraId: { type: 'string' } },
};
const validOutput = { eraId: 'barrier_healing' };
const fakeContract = {
  outputSchema: schema,
  buildMessages: ({ language }) => ({ system: 'system prompt', messages: [{ role: 'user', content: `Language: ${language}` }] }),
  validateOutput: output => ({ errors: output.eraId === 'barrier_healing' ? [] : ['unexpected era'] }),
};
const testCase = { caseId: 'case-001', quiz: { skin_goals: ['dryness'] }, images: [] };
const usage = { prompt_tokens: 1000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 100 } };
const completion = (content, extra = {}) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage, ...extra }),
});

test('standard-tier accounting uses cached input rate and charges reasoning as completion tokens', () => {
  const result = calculateCost(usage);
  const expected = ((800 * 2.2) + (200 * 0.55) + (300 * 6.6)) / 1_000_000;
  assert.equal(result.usd, expected);
  assert.equal(result.outputTokens, 300);
  assert.equal(calculateCost(null), null);
  for (const invalid of [
    { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 1.5, completion_tokens: 2 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 2 },
    { prompt_tokens: 1, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 2 } },
  ]) assert.equal(calculateCost(invalid), null);
});

test('a valid response uses the fixed Oregon Grok endpoint and strict response schema', async () => {
  const calls = [];
  const report = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return completion(JSON.stringify(validOutput));
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE_URL}/chat/completions`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, MODEL);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_completion_tokens, 8000);
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'skin_analysis', strict: true, schema } });
  assert.equal(report.results[0].status, 'valid');
  assert.equal(report.results[0].withinAnalysisCostCeiling, true);
  assert.equal(report.results[0].attempts[0].finishReason, 'stop');
});

test('only completed stop/completed finish reasons are accepted', async () => {
  for (const finishReason of [undefined, 'length', 'content_filter', 'tool_calls']) {
    const response = completion(JSON.stringify(validOutput), {
      choices: [{ message: { content: JSON.stringify(validOutput) }, finish_reason: finishReason }],
    });
    const report = await runEvaluations({
      cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
      fetchImpl: async () => response,
    });
    assert.equal(report.results[0].valid, false);
  }
  const completed = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    fetchImpl: async () => completion(JSON.stringify(validOutput), {
      choices: [{ message: { content: JSON.stringify(validOutput) }, finish_reason: 'completed' }],
    }),
  });
  assert.equal(completed.results[0].valid, true);
});

test('request latency includes time spent reading the response body', async () => {
  const report = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => {
        await delay(40);
        return JSON.stringify({ choices: [{ message: { content: JSON.stringify(validOutput) }, finish_reason: 'stop' }], usage });
      },
    }),
  });
  assert.ok(report.results[0].attempts[0].latencyMs >= 30);
});

test('a completed invalid response gets one bounded correction attempt', async () => {
  let calls = 0;
  const progress = [];
  const report = await runEvaluations({
    cases: [testCase], languages: ['he'], catalogue: [], contract: fakeContract, token: 'test-token', maxAttempts: 2,
    onAttempt: entry => progress.push(entry),
    fetchImpl: async () => {
      calls += 1;
      return completion(JSON.stringify(calls === 1 ? { eraId: 'wrong', extra: true } : validOutput));
    },
  });
  assert.equal(calls, 2);
  assert.equal(report.results[0].valid, true);
  assert.deepEqual(report.results[0].attempts.map(attempt => attempt.status), ['invalid_output', 'valid']);
  assert.deepEqual(progress.map(entry => [entry.attempt, entry.status]), [[1, 'invalid_output'], [2, 'valid']]);
  assert.equal(Object.hasOwn(progress[0], 'output'), false);
});

test('the saved seed catalogue is usable through stable seedKey IDs', async () => {
  const catalogue = await readCatalogue(require('node:path').resolve(__dirname, '../../server/data/catalogue-seed/products.json'));
  assert.equal(catalogue.length, 34);
  assert.equal(new Set(catalogue.map(product => product._id)).size, 34);
  assert.equal(catalogue.find(product => product.seedKey === 'herbal-cleansing-mousse')._id, 'herbal-cleansing-mousse');
  assert.equal(MAX_ATTEMPTS, 1);
});

test('a partial budget-stopped report cannot be reported as a successful CLI run', () => {
  const validResult = { valid: true, withinAnalysisCostCeiling: true };
  assert.equal(isSuccessfulReport({ results: [validResult], stopReason: null }, 1), true);
  assert.equal(isSuccessfulReport({ results: [validResult], stopReason: 'run cost cap reached' }, 1), false);
  assert.equal(isSuccessfulReport({ results: [validResult], stopReason: null }, 2), false);
});

test('analysis-cost CLI option cannot exceed the approved quarter-dollar ceiling', () => {
  assert.equal(numberOption({}, 'max-analysis-cost', 0.25, 0.01, 0.25), 0.25);
  assert.throws(() => numberOption({ 'max-analysis-cost': '0.26' }, 'max-analysis-cost', 0.25, 0.01, 0.25), /between 0.01 and 0.25/);
});

test('a one-attempt run records known usage and leaves an invalid answer invalid', async () => {
  let calls = 0;
  const report = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token', maxAttempts: 1,
    fetchImpl: async () => {
      calls += 1;
      return completion(JSON.stringify({ eraId: 'wrong', extra: true }));
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.maxAttempts, 1);
  assert.equal(report.results[0].valid, false);
  assert.equal(report.results[0].status, 'invalid_output');
  assert.equal(report.results[0].costUsd, calculateCost(usage).usd);
  assert.equal(report.costUnknown, false);
});

test('maxAttempts only accepts one or two attempts', async () => {
  for (const maxAttempts of [0, 1.5, 3, '1']) {
    await assert.rejects(runEvaluations({
      cases: [], languages: [], catalogue: [], contract: fakeContract, token: 'test-token', maxAttempts,
    }), /maxAttempts must be either 1 or 2/);
  }
});

test('provider errors are recorded once and missing usage remains unknown rather than free', async () => {
  let calls = 0;
  const report = await runEvaluations({
    cases: [testCase, { ...testCase, caseId: 'case-002' }], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 403, statusText: 'Forbidden', text: async () => JSON.stringify({ error: { message: 'not authorized' } }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.results[0].status, 'api_error');
  assert.equal(report.results[0].costUsd, null);
  assert.equal(report.costUnknown, true);
  assert.match(report.stopReason, /cost is unknown/);
  assert.equal(PRICING.inputPerMillionUsd, 2.2);
});

test('an invalid response with missing usage is not retried at unknown cost', async () => {
  let calls = 0;
  const report = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"wrong":true}' }, finish_reason: 'stop' }] }) };
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.results[0].costUsd, null);
  assert.equal(report.results[0].attempts[0].status, 'invalid_output');
  assert.equal(report.costUnknown, true);
});

test('image paths cannot escape their case folder', async () => {
  await assert.rejects(
    loadCaseImages('C:\\private\\case-001', [{ angle: 'front', mediaType: 'image/jpeg', path: '..\\outside.jpg' }]),
    /escapes its case folder/,
  );
});

test('case image loader enforces supported formats, signatures, labels, and angle counts', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64');
  const images = await loadCaseImages('.', [
    { angle: 'front', mediaType: 'image/jpeg', base64: jpeg },
    { angle: 'shelf-01', mediaType: 'image/png', base64: png },
  ]);
  assert.deepEqual(images.map(image => image.angle), ['front', 'shelf']);
  await assert.rejects(loadCaseImages('.', [{ angle: 'front', mediaType: 'image/webp', base64: jpeg }]), /unsupported mediaType/);
  await assert.rejects(loadCaseImages('.', [{ angle: 'front', mediaType: 'image/png', base64: jpeg }]), /does not match/);
  await assert.rejects(loadCaseImages('.', [
    { angle: 'front', mediaType: 'image/jpeg', base64: jpeg },
    { angle: 'front', mediaType: 'image/jpeg', base64: jpeg },
  ]), /duplicate angle/);
  await assert.rejects(loadCaseImages('.', Array.from({ length: 6 }, (_, i) => ({
    angle: `shelf-${i + 1}`, mediaType: 'image/png', base64: png,
  }))), /too many images/);
  const largeBytes = Buffer.alloc(MAX_IMAGE_BYTES, 0x01);
  largeBytes.set([0xff, 0xd8, 0xff]);
  const largeBase64 = largeBytes.toString('base64');
  await assert.rejects(loadCaseImages('.', [
    { angle: 'front', mediaType: 'image/jpeg', base64: largeBase64 },
    { angle: 'left', mediaType: 'image/jpeg', base64: largeBase64 },
    { angle: 'right', mediaType: 'image/jpeg', base64: largeBase64 },
    { angle: 'closeup', mediaType: 'image/jpeg', base64: jpeg },
  ]), /24 MiB total limit/);
});

test('the run cost guard stops before starting another logical analysis', async () => {
  let calls = 0;
  const costlyUsage = { prompt_tokens: 1_000, completion_tokens: 300 };
  const report = await runEvaluations({
    cases: [testCase, { ...testCase, caseId: 'case-002' }], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token', maxRunCostUsd: 0.001,
    fetchImpl: async () => {
      calls += 1;
      return completion(JSON.stringify(validOutput), { usage: costlyUsage });
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.results.length, 1);
  assert.equal(report.stopReason, 'run cost cap reached');
});
