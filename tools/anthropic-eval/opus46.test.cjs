const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Ajv = require('ajv');
const { outputSchema, validateOutput } = require('../../server/services/anthropic/analysisContract');
const { loadSeedCatalogue: loadCatalogue } = require('../../server/services/anthropic/catalogue');
const { prepareSkinRequest } = require('../../server/services/anthropic/skinRequest');
const { MODEL, COUNT_MODEL, BASE_URL, COUNT_URL, INPUT_COUNT_ALLOWANCE_TOKENS, makeWireSchema, toAnthropicInput,
  promptFingerprint, maxOutputTokens, reportedCostUsd, countTokens, infer, validateAjvOutput, verifyCountReport, main } = require('./opus46.cjs');

function validNoImageOutput() {
  return {
    era: {
      era: { id: 'barrier_healing', affirmation: 'A gentle routine can support steady skin care.' },
      skin_analysis: { summary: 'Your skin may benefit from a simple routine.', key_insights: [] },
      routine: { am: [
        { category_id: 'cleanse', category: 'Cleanse', instruction: 'Use a gentle cleanser.' },
        { category_id: 'moisturize', category: 'Moisturize', instruction: 'Apply a moisturizer.' },
        { category_id: 'protect', category: 'Protect', instruction: 'Use sunscreen.' },
      ], pm: [
        { category_id: 'cleanse', category: 'Cleanse', instruction: 'Cleanse gently.' },
        { category_id: 'moisturize', category: 'Moisturize', instruction: 'Apply moisturizer.' },
      ] },
      product_audit: { current_products_assessment: [], most_urgent_gap: null },
      check_in_prompts: [], safety_flags: [], event_prep: null,
    },
    srProducts: null,
    shelfAnalysis: null,
  };
}

async function makeCaseDirectory(caseId = 'case-568f7d2ab3', quiz = {}, images = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anthropic-probe-'));
  const caseDirectory = path.join(directory, caseId);
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId, quiz, images }));
  return directory;
}

function counted(inputTokens = 10_000) { return async () => ({ inputTokens }); }
function validCompletion(options, output = validNoImageOutput()) {
  options.onEvent({ phase: 'counted', inputTokens: 10_000, outputTokenLimit: options.maxOutputTokens });
  options.onEvent({ phase: 'usage', usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } }, costUsd: 0.0008 });
  options.onEvent({ phase: 'complete', finishReason: 'end_turn' });
  return output;
}

test('wire schema preserves structure while local validation retains the full canonical constraints', () => {
  const wire = makeWireSchema(outputSchema);
  assert.notEqual(wire, outputSchema);
  assert.deepEqual(wire.required, outputSchema.required);
  assert.equal(wire.properties.era.properties.routine.properties.am.minItems, undefined);
  assert.equal(outputSchema.properties.era.properties.routine.properties.am.minItems, 3);
  const prepared = prepareSkinRequest({ quiz: {}, language: 'en', images: [], catalogue: loadCatalogue() });
  assert.deepEqual(prepared.wireSchema.properties.shelfAnalysis, { type: 'null' });
  assert.deepEqual(validateAjvOutput(validNoImageOutput()), []);
  assert.deepEqual(validateOutput(validNoImageOutput(), { quiz: {}, language: 'en', images: [] }, loadCatalogue()).errors, []);
});

test('Anthropic input preserves production messages and image blocks for shared count and inference', () => {
  const built = { system: 'system text', messages: [{ role: 'user', content: [
    { type: 'text', text: 'input text' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/AA==' } },
  ] }] };
  const result = toAnthropicInput(built, { type: 'object' });
  assert.equal(result.system, built.system);
  assert.deepEqual(result.messages, built.messages);
  assert.deepEqual(result.schema, { type: 'object' });
});

test('countTokens delegates exact prompt, schema, token and deadline to the shared SDK helper', async () => {
  let received;
  const phases = [];
  const result = await countTokens({ system: 'system', messages: [{ role: 'user', content: 'prompt' }], schema: outputSchema,
    wireSchema: makeWireSchema(outputSchema), token: 'test-key', timeoutMs: 4000, onPhase: phase => phases.push(phase),
    countImpl: async args => { received = args; return { inputTokens: 42 }; } });
  assert.equal(received.token, 'test-key');
  assert.equal(received.timeoutMs, 4000);
  assert.deepEqual(received.messages, [{ role: 'user', content: 'prompt' }]);
  assert.deepEqual(received.wireSchema, makeWireSchema(outputSchema));
  assert.equal(result.inputTokens, 42);
  assert.equal(result.providerRequestId, null);
  assert.deepEqual(phases.map(phase => phase.phase), ['request_start', 'counted']);
});

test('inference uses the shared Anthropic completion and retains safe usage and token budget', async () => {
  let request;
  const phases = [];
  const result = await infer({ system: 'system', messages: [{ role: 'user', content: 'prompt' }], wireSchema: makeWireSchema(outputSchema),
    token: 'test-key', maxTokens: 321, onPhase: event => phases.push(event),
    completeImpl: async options => { request = options; return validCompletion(options); } });
  assert.equal(request.token, 'test-key');
  assert.equal(request.maxOutputTokens, 321);
  assert.equal(request.maxCostUsd, 0.25);
  assert.deepEqual(request.schema, makeWireSchema(outputSchema));
  assert.equal(result.output.era.era.id, 'barrier_healing');
  assert.equal(result.inputTokens, 10_000);
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.costUsd, 0.0008);
  assert.equal(result.stopReason, 'end_turn');
  assert.ok(phases.some(event => event.phase === 'usage'));
});

test('input cost estimate uses the Anthropic rate, allowance and output reserve', () => {
  assert.equal(INPUT_COUNT_ALLOWANCE_TOKENS, 128);
  assert.equal(maxOutputTokens(1), 8_000);
  const input = 40_000;
  const limit = maxOutputTokens(input);
  const estimatedUpperCost = ((input + INPUT_COUNT_ALLOWANCE_TOKENS) * 4 + limit * 20) / 1_000_000;
  assert.ok(limit > 0);
  assert.ok(estimatedUpperCost <= 0.25 - 0.01);
  assert.ok(estimatedUpperCost + 20 / 1_000_000 > 0.25 - 0.01);
  assert.equal(maxOutputTokens(60_000), 0);
  assert.equal(maxOutputTokens(0), 0);
  assert.equal(reportedCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 24);
  assert.equal(reportedCostUsd({ inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 1 }), null);
});

test('count reports name Anthropic provenance and reject historical Bedrock counts', () => {
  const count = { mode: 'count', status: 'counted', provider: 'anthropic', countApi: 'anthropic-sdk', promptSha256: 'fingerprint',
    model: MODEL, countModel: COUNT_MODEL, countMethod: 'anthropic-messages-count-tokens-v1', schemaAwareCount: true,
    inputTokens: 20_000, outputTokenLimit: maxOutputTokens(20_000) };
  assert.equal(verifyCountReport(count, 'fingerprint'), true);
  assert.equal(verifyCountReport({ ...count, provider: 'bedrock' }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, countApi: 'bedrock-runtime' }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, model: 'us.anthropic.claude-opus-4-6-v1' }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, countMethod: 'legacy-text-only' }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, outputTokenLimit: 8_000 }, 'fingerprint'), false);
});

test('count CLI retains prompt/catalogue data while using the shared SDK count preflight', async t => {
  const directory = await makeCaseDirectory('case-dddddddddd', { pregnant_or_ttc: false, allergies: ['none'], irritants: ['none'] });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const catalogueFile = path.join(directory, 'catalogue.json');
  const productId = '507f1f77bcf86cd799439011';
  await fs.writeFile(catalogueFile, JSON.stringify({ products: [{ _id: productId, name: 'Snapshot Cream', category: 'face_creams',
    use: 'home', pregnancy: 'safe', archived: false, keyActives: [], strengths: [], suitableFor: [], ingredients: '' }] }));
  const outputFile = path.join(directory, 'count.json');
  const previousExitCode = process.exitCode;
  try {
    const report = await main(['--mode', 'count', '--case-id', 'case-dddddddddd', '--input-dir', directory,
      '--catalogue-file', catalogueFile, '--output', outputFile], {
      getToken: () => 'test-key',
      countTokensImpl: async request => {
        const serialized = JSON.stringify(request.messages);
        assert.match(serialized, new RegExp(productId));
        assert.match(serialized, /Snapshot Cream/);
        assert.deepEqual(request.wireSchema.properties.shelfAnalysis, { type: 'null' });
        return { inputTokens: 10_000 };
      },
    });
    assert.equal(report.status, 'counted');
    assert.equal(report.provider, 'anthropic');
    assert.equal(report.countApi, 'anthropic-sdk');
    assert.equal(report.countMethod, 'anthropic-messages-count-tokens-v1');
    assert.equal(report.outputTokenLimit, maxOutputTokens(10_000));
  } finally { process.exitCode = previousExitCode; }
});

test('count and analysis use matching prompt/schema fingerprints and analysis retains cost on local schema errors', async t => {
  const directory = await makeCaseDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const countFile = path.join(directory, 'count.json');
  const previousExitCode = process.exitCode;
  try {
    const count = await main(['--mode', 'count', '--input-dir', directory, '--output', countFile], {
      getToken: () => 'test-key', countTokensImpl: counted(),
    });
    const analysis = await main(['--mode', 'analysis', '--input-dir', directory, '--output', path.join(directory, 'analysis.json'), '--count-report', countFile], {
      getToken: () => 'test-key',
      completeImpl: async options => validCompletion(options, {}),
    });
    assert.equal(analysis.failureCategory, 'validation');
    assert.ok(analysis.schemaErrorCount > 0);
    assert.equal(analysis.costUsd, 0.0008);
    assert.equal(analysis.costUnknown, false);
    await fs.writeFile(countFile, JSON.stringify({ ...count, provider: 'bedrock' }));
    let inferenceCalls = 0;
    const rejected = await main(['--mode', 'analysis', '--input-dir', directory, '--output', path.join(directory, 'rejected.json'), '--count-report', countFile], {
      getToken: () => 'test-key', completeImpl: async options => { inferenceCalls += 1; return validCompletion(options); },
    });
    assert.equal(rejected.failureCategory, 'budget');
    assert.equal(inferenceCalls, 0);
  } finally { process.exitCode = previousExitCode; }
});

test('count failure leaves a safe checkpoint and never exposes prompt or provider prose', async t => {
  const directory = await makeCaseDirectory('case-568f7d2ab3', { privateQuiz: 'PRIVATE_QUIZ' });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const outputFile = path.join(directory, 'count.json');
  const previousExitCode = process.exitCode;
  try {
    const report = await main(['--mode', 'count', '--input-dir', directory, '--output', outputFile], {
      getToken: () => 'PRIVATE_TOKEN',
      countTokensImpl: async () => { throw Object.assign(new Error('PRIVATE_PROVIDER_DETAIL'), { code: 'ANTHROPIC_HTTP_403', status: 403 }); },
    });
    assert.equal(report.failureCategory, 'access');
    assert.equal(report.failureReason, 'ANTHROPIC_HTTP_403');
    assert.equal(report.httpStatus, 403);
    for (const value of ['PRIVATE_TOKEN', 'PRIVATE_PROVIDER_DETAIL', 'PRIVATE_QUIZ']) assert.equal(JSON.stringify(report).includes(value), false);
  } finally { process.exitCode = previousExitCode; }
});

test('the evaluator exports direct Anthropic endpoint constants and shared helper surfaces', () => {
  assert.equal(BASE_URL, 'https://api.anthropic.com/v1');
  assert.equal(COUNT_URL, 'https://api.anthropic.com/v1/messages/count_tokens');
  const invalid = { era: { era: { id: 'barrier_healing', affirmation: 'test' }, skin_analysis: { summary: 'test', key_insights: [] },
    routine: { am: [], pm: [] }, product_audit: { current_products_assessment: [], most_urgent_gap: null },
    check_in_prompts: [], safety_flags: [], event_prep: null }, srProducts: null, shelfAnalysis: null };
  assert.ok(validateAjvOutput(invalid).some(error => error.keyword === 'minItems' && error.instancePath === '/era/routine/am'));
  assert.equal(promptFingerprint({ a: 1 }), promptFingerprint({ a: 1 }));
});
