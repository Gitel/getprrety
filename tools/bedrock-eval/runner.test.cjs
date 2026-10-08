const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const {
  BASE_URL,
  MODEL,
  PRICING,
  calculateCost,
  loadCaseImages,
  runEvaluations,
} = require('./runner.cjs');

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
    cases: [testCase], languages: ['he'], catalogue: [], contract: fakeContract, token: 'test-token',
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
