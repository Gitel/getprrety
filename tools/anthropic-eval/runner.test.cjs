const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  BASE_URL, MAX_ATTEMPTS, MODEL, PRICING, TIMEOUT_MS, calculateCost, loadCaseImages, readCatalogue, runEvaluations,
} = require('./runner.cjs');
const { getToken, isSuccessfulReport, numberOption } = require('./run.cjs');
const MAX_IMAGE_BYTES = Math.floor(3.75 * 1024 * 1024);

const schema = { type: 'object', required: ['eraId'], additionalProperties: false, properties: { eraId: { type: 'string' } } };
const validOutput = { eraId: 'barrier_healing' };
const fakeContract = {
  outputSchema: schema,
  buildMessages: ({ language }) => ({ system: 'system prompt', messages: [{ role: 'user', content: `Language: ${language}` }] }),
  validateOutput: output => ({ errors: output.eraId === 'barrier_healing' ? [] : ['unexpected era'] }),
};
const testCase = { caseId: 'case-001', quiz: { skin_goals: ['dryness'] }, images: [] };
const usage = { prompt_tokens: 1000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 0 } };
const cost = calculateCost(usage).usd;

test('credentials come only from the Anthropic API key setting', () => {
  assert.equal(getToken(undefined, { ANTHROPIC_API_KEY: 'anthropic-test-key' }), 'anthropic-test-key');
  assert.throws(() => getToken(undefined, { AWS_BEARER_TOKEN_BEDROCK: 'old-bedrock-key' }), /ANTHROPIC_API_KEY/);
});

test('Anthropic cost accounting rejects unsafe normalized usage', () => {
  assert.equal(calculateCost(usage).usd, ((1000 * 4) + (300 * 20)) / 1_000_000);
  assert.equal(calculateCost(null), null);
  for (const invalid of [
    { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: 1.5, completion_tokens: 2 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 2 },
    { prompt_tokens: 1, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 2 } },
  ]) assert.equal(calculateCost(invalid), null);
});

test('shared Anthropic adapter receives the existing case prompt and contract schema', async () => {
  assert.equal(TIMEOUT_MS, 90_000);
  let request;
  const report = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    completeImpl: async options => {
      request = options;
      options.onEvent({ phase: 'usage', usage, costUsd: cost });
      return validOutput;
    },
  });
  assert.equal(request.token, 'test-token');
  assert.equal(request.system, 'system prompt');
  assert.deepEqual(request.messages, [{ role: 'user', content: 'Language: en' }]);
  assert.deepEqual(request.schema, schema);
  assert.equal(request.schemaName, 'skin_analysis');
  assert.equal(request.maxCostUsd, 0.25);
  assert.equal(report.model, MODEL);
  assert.equal(report.endpoint, BASE_URL);
  assert.equal(report.results[0].status, 'valid');
  assert.equal(report.results[0].withinAnalysisCostCeiling, true);
  assert.equal(report.results[0].costUsd, cost);
});

test('a completed semantic failure gets one bounded correction attempt', async () => {
  let calls = 0;
  let correction;
  const progress = [];
  const report = await runEvaluations({
    cases: [testCase], languages: ['he'], catalogue: [], contract: fakeContract, token: 'test-token', maxAttempts: 2,
    onAttempt: entry => progress.push(entry),
    completeImpl: async options => {
      calls += 1;
      if (calls === 2) correction = options.messages.at(-1).content;
      options.onEvent({ phase: 'usage', usage, costUsd: cost });
      return calls === 1 ? { eraId: 'wrong', extra: true } : validOutput;
    },
  });
  assert.match(correction, /failed these checks/);
  assert.equal(calls, 2);
  assert.equal(report.results[0].valid, true);
  assert.deepEqual(report.results[0].attempts.map(attempt => attempt.status), ['invalid_output', 'valid']);
  assert.deepEqual(progress.map(entry => [entry.attempt, entry.status]), [[1, 'invalid_output'], [2, 'valid']]);
  assert.equal(Object.hasOwn(progress[0], 'output'), false);
});

test('the saved seed catalogue and one-attempt default remain stable', async () => {
  const catalogue = await readCatalogue(require('node:path').resolve(__dirname, '../../server/data/catalogue-seed/products.json'));
  assert.equal(catalogue.length, 34);
  assert.equal(new Set(catalogue.map(product => product._id)).size, 34);
  assert.equal(catalogue.find(product => product.seedKey === 'herbal-cleansing-mousse')._id, 'herbal-cleansing-mousse');
  assert.equal(MAX_ATTEMPTS, 1);
});

test('partial budget-stopped results are not successful and CLI limits remain bounded', () => {
  const validResult = { valid: true, withinAnalysisCostCeiling: true };
  assert.equal(isSuccessfulReport({ results: [validResult], stopReason: null }, 1), true);
  assert.equal(isSuccessfulReport({ results: [validResult], stopReason: 'run cost cap reached' }, 1), false);
  assert.equal(isSuccessfulReport({ results: [validResult], stopReason: null }, 2), false);
  assert.equal(numberOption({}, 'max-analysis-cost', 0.25, 0.01, 0.25), 0.25);
  assert.throws(() => numberOption({ 'max-analysis-cost': '0.26' }, 'max-analysis-cost', 0.25, 0.01, 0.25), /between 0.01 and 0.25/);
});

test('invalid output retains known cost and does not retry by default', async () => {
  let calls = 0;
  const report = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token', maxAttempts: 1,
    completeImpl: async options => { calls += 1; options.onEvent({ phase: 'usage', usage, costUsd: cost }); return { eraId: 'wrong', extra: true }; },
  });
  assert.equal(calls, 1);
  assert.equal(report.maxAttempts, 1);
  assert.equal(report.results[0].valid, false);
  assert.equal(report.results[0].status, 'invalid_output');
  assert.equal(report.results[0].costUsd, cost);
  assert.equal(report.costUnknown, false);
});

test('provider errors stop the run and retain only fixed Anthropic metadata', async () => {
  let calls = 0;
  const report = await runEvaluations({
    cases: [testCase, { ...testCase, caseId: 'case-002' }], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    completeImpl: async () => { calls += 1; throw Object.assign(new Error('private provider detail'), { code: 'ANTHROPIC_HTTP_403', status: 403 }); },
  });
  assert.equal(calls, 1);
  assert.equal(report.results[0].status, 'api_error');
  assert.equal(report.results[0].attempts[0].error, 'ANTHROPIC_HTTP_403');
  assert.equal(report.results[0].costUsd, null);
  assert.equal(report.costUnknown, true);
  assert.match(report.stopReason, /cost is unknown/);
  assert.equal(PRICING.inputPerMillionUsd, 4);
});

test('an invalid response with unknown cost is not retried', async () => {
  let calls = 0;
  const report = await runEvaluations({
    cases: [testCase], languages: ['en'], catalogue: [], contract: fakeContract, token: 'test-token',
    completeImpl: async () => { calls += 1; throw Object.assign(new Error('invalid JSON'), { code: 'ANTHROPIC_JSON_INVALID' }); },
  });
  assert.equal(calls, 1);
  assert.equal(report.results[0].costUsd, null);
  assert.equal(report.results[0].attempts[0].status, 'invalid_output');
  assert.equal(report.costUnknown, true);
});

test('maxAttempts and run cost guard prevent unbounded provider calls', async () => {
  for (const maxAttempts of [0, 1.5, 3, '1']) {
    await assert.rejects(runEvaluations({ cases: [], languages: [], catalogue: [], contract: fakeContract, token: 'test-token', maxAttempts }), /maxAttempts must be either 1 or 2/);
  }
  let calls = 0;
  const costlyUsage = { prompt_tokens: 1000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 0 } };
  const report = await runEvaluations({
    cases: [testCase, { ...testCase, caseId: 'case-002' }], languages: ['en'], catalogue: [], contract: fakeContract,
    token: 'test-token', maxRunCostUsd: 0.001,
    completeImpl: async options => { calls += 1; options.onEvent({ phase: 'usage', usage: costlyUsage, costUsd: calculateCost(costlyUsage).usd }); return validOutput; },
  });
  assert.equal(calls, 1);
  assert.equal(report.results.length, 1);
  assert.equal(report.stopReason, 'run cost cap reached');
});

test('case image loader preserves local path and format limits', async () => {
  await assert.rejects(loadCaseImages('C:\\private\\case-001', [{ angle: 'front', mediaType: 'image/jpeg', path: '..\\outside.jpg' }]), /escapes its case folder/);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64');
  const images = await loadCaseImages('.', [
    { angle: 'front', mediaType: 'image/jpeg', base64: jpeg },
    { angle: 'shelf-01', mediaType: 'image/png', base64: png },
  ]);
  assert.deepEqual(images.map(image => image.angle), ['front', 'shelf']);
  await assert.rejects(loadCaseImages('.', [{ angle: 'front', mediaType: 'image/webp', base64: jpeg }]), /unsupported mediaType/);
  await assert.rejects(loadCaseImages('.', [{ angle: 'front', mediaType: 'image/png', base64: jpeg }]), /does not match/);
  const tooLarge = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x01);
  tooLarge.set([0xff, 0xd8, 0xff]);
  await assert.rejects(loadCaseImages('.', [{ angle: 'front', mediaType: 'image/jpeg', base64: tooLarge.toString('base64') }]), /3.75 MiB limit/);
  await assert.rejects(loadCaseImages('.', [
    { angle: 'front', mediaType: 'image/jpeg', base64: jpeg },
    { angle: 'front', mediaType: 'image/jpeg', base64: jpeg },
  ]), /duplicate angle/);
  const largeBytes = Buffer.alloc(Math.floor(3.5 * 1024 * 1024), 0x01);
  largeBytes.set([0xff, 0xd8, 0xff]);
  const boundaryBytes = Buffer.alloc(MAX_IMAGE_BYTES, 0x01);
  boundaryBytes.set([0xff, 0xd8, 0xff]);
  assert.equal((await loadCaseImages('.', [{ angle: 'front', mediaType: 'image/jpeg', base64: boundaryBytes.toString('base64') }]))[0].base64.length, boundaryBytes.toString('base64').length);
  await assert.rejects(loadCaseImages('.', [
    ...['front', 'left', 'right', 'closeup', 'neck', 'shelf-1', 'shelf-2'].map(angle => ({ angle, mediaType: 'image/jpeg', base64: largeBytes.toString('base64') })),
  ]), /24 MiB total limit/);
});
