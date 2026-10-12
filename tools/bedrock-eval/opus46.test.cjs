const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Ajv = require('ajv');
const { outputSchema, validateOutput } = require('../../server/services/bedrock/analysisContract');
const { loadCatalogue } = require('../../server/services/bedrock/catalogue');
const { MODEL, COUNT_MODEL, BASE_URL, MANTLE_COUNT_URL, INPUT_COUNT_ALLOWANCE_TOKENS, makeWireSchema, toConverse, promptFingerprint, maxOutputTokens, reportedCostUsd, requestJson, countTokens, infer, validateAjvOutput, verifyCountReport, main } = require('./opus46.cjs');

function response(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

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

test('wire schema drops Bedrock-unsupported bounds but preserves structure for local contract validation', () => {
  const wire = makeWireSchema(outputSchema);
  assert.notEqual(wire, outputSchema);
  assert.equal(wire.type, outputSchema.type);
  assert.deepEqual(wire.required, outputSchema.required);
  assert.deepEqual(wire.$defs.routineStep.properties.category_id.enum, outputSchema.$defs.routineStep.properties.category_id.enum);
  assert.equal(wire.properties.era.properties.routine.properties.am.minItems, undefined);
  assert.equal(wire.properties.era.properties.routine.properties.pm.items.$ref, '#/$defs/routineStep');
  assert.equal(outputSchema.properties.era.properties.routine.properties.am.minItems, 3);
});

test('wire schema collapses nullable object combinators while canonical validation remains authoritative', () => {
  const canonicalBefore = structuredClone(outputSchema);
  const wire = makeWireSchema(outputSchema);
  const countKeyword = (value, keyword) => {
    if (!value || typeof value !== 'object') return 0;
    let count = Array.isArray(value) ? 0 : Object.hasOwn(value, keyword) ? 1 : 0;
    for (const child of Array.isArray(value) ? value : Object.values(value)) count += countKeyword(child, keyword);
    return count;
  };
  const wireValidator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(wire);
  const validOutput = validNoImageOutput();
  assert.equal(countKeyword(outputSchema, 'anyOf'), 3);
  assert.equal(countKeyword(wire, 'anyOf'), 0);
  assert.equal(wireValidator(validOutput), true);
  assert.deepEqual(validateAjvOutput(validOutput), []);
  assert.deepEqual(validateOutput(validOutput, { quiz: {}, language: 'en', images: [] }, loadCatalogue()).errors, []);

  const nullableBranches = [
    ['era', 'event_prep'], ['srProducts'], ['shelfAnalysis'],
  ];
  for (const pathParts of nullableBranches) {
    const schemaAt = pathParts.reduce((value, key) => key === 'era' ? value.properties.era : key === 'event_prep' ? value.properties.event_prep : key === 'srProducts' ? value.properties.srProducts : value.properties.shelfAnalysis, wire);
    assert.deepEqual(schemaAt.type, ['object', 'null']);
    const present = structuredClone(validOutput);
    if (pathParts[0] === 'era') present.era.event_prep = { summary: 'Plan ahead gently.', steps: [] };
    else if (pathParts[0] === 'srProducts') present.srProducts = { bundle_note: 'A simple set.', era_hero_product: { sr_product_id: null, sr_product_name: '', hero_reason: 'No verified match.' }, am: [], pm: [] };
    else present.shelfAnalysis = { identified_products: [], shelf_summary: { overall_note: 'No products identified.' }, transition_plan: { first_sr_purchase: '', first_sr_purchase_product_id: null } };
    assert.equal(wireValidator(present), true);
    assert.deepEqual(validateAjvOutput(present), []);

    const malformed = structuredClone(present);
    if (pathParts[0] === 'era') malformed.era.event_prep = { summary: 'Missing steps.' };
    else if (pathParts[0] === 'srProducts') malformed.srProducts = { bundle_note: 'Missing fields.' };
    else malformed.shelfAnalysis = { identified_products: [] };
    assert.equal(wireValidator(malformed), false);
    assert.ok(validateAjvOutput(malformed).length > 0);
  }
  assert.deepEqual(outputSchema, canonicalBefore);
});

test('no-photo probe sends shelf-null schema to count and inference without changing canonical validation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-shelf-schema-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseDirectory = path.join(directory, 'case-568f7d2ab3');
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId: 'case-568f7d2ab3', quiz: {}, images: [] }));
  const countFile = path.join(directory, 'count.json');
  const countOutput = path.join(directory, 'count-output.json');
  const analysisOutput = path.join(directory, 'analysis-output.json');
  const previousExitCode = process.exitCode;
  let countedSchema;
  let inferredSchema;
  try {
    const counted = await main(['--mode', 'count', '--input-dir', directory, '--output', countOutput], {
      getToken: () => 'test-token',
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        countedSchema = body.input.converse.additionalModelRequestFields.output_config.format.schema;
        return response({ inputTokens: 10_000 });
      },
    });
    await fs.writeFile(countFile, JSON.stringify(counted));
    const analysis = await main(['--mode', 'analysis', '--input-dir', directory, '--output', analysisOutput, '--count-report', countFile], {
      getToken: () => 'test-token',
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        inferredSchema = JSON.parse(body.outputConfig.textFormat.structure.jsonSchema.schema);
        return response({ output: { message: { content: [{ text: '{}' }] } }, usage: { inputTokens: 100, outputTokens: 20 }, stopReason: 'end_turn' });
      },
    });
    assert.equal(counted.status, 'counted');
    assert.equal(analysis.failureCategory, 'validation');
    assert.deepEqual(countedSchema, inferredSchema);
    assert.deepEqual(countedSchema.properties.shelfAnalysis, { type: 'null' });
    const genericSchema = makeWireSchema(outputSchema);
    const countUnionNodes = schema => !schema || typeof schema !== 'object' ? 0
      : (Array.isArray(schema.type) && schema.type.length > 1 ? 1 : 0)
        + (Array.isArray(schema.anyOf) && schema.anyOf.length > 1 ? 1 : 0)
        + Object.values(schema).reduce((total, child) => total + countUnionNodes(child), 0);
    assert.ok(countUnionNodes(countedSchema) < countUnionNodes(genericSchema));
    assert.ok(Buffer.byteLength(JSON.stringify(countedSchema)) < Buffer.byteLength(JSON.stringify(genericSchema)));

    const validOutput = validNoImageOutput();
    assert.deepEqual(validateAjvOutput(validOutput), []);
    assert.deepEqual(validateOutput(validOutput, { quiz: {}, language: 'en', images: [] }, loadCatalogue()).errors, []);
    const shapedShelfOutput = structuredClone(validOutput);
    shapedShelfOutput.shelfAnalysis = { identified_products: [], shelf_summary: { overall_note: 'Products reviewed.' }, transition_plan: { first_sr_purchase: '', first_sr_purchase_product_id: null } };
    assert.deepEqual(validateAjvOutput(shapedShelfOutput), []);
    assert.ok(validateOutput(shapedShelfOutput, { quiz: {}, language: 'en', images: [] }, loadCatalogue()).errors.includes('shelfAnalysis must be null when no shelf photos were provided'));
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('Converse builder preserves typed text and every validated inline photo', () => {
  const built = { system: 'system text', messages: [{ role: 'user', content: [{ type: 'text', text: 'input text' }] }] };
  const normal = toConverse(built);
  assert.deepEqual(normal.system, [{ text: 'system text' }]);
  assert.deepEqual(normal.messages[0].content, [{ text: 'input text' }]);
  assert.equal(normal.outputConfig.textFormat.type, 'json_schema');
  assert.equal(normal.outputConfig.textFormat.structure.jsonSchema.schema, JSON.stringify(makeWireSchema(outputSchema)));
  const withPhoto = toConverse({ ...built, messages: [{ role: 'user', content: [
    { type: 'text', text: 'photo follows' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/AA==' } },
  ] }] });
  assert.deepEqual(withPhoto.messages[0].content[1], { image: { format: 'jpeg', source: { bytes: '/9j/AA==' } } });
  assert.throws(() => toConverse({ ...built, messages: [{ role: 'user', content: [{ type: 'image_url' }] }] }), /unsupported content block/);
});

test('selected safe case ID and Hebrew language carry linked photo evidence into CountTokens', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-case-selection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseId = 'case-aaaaaaaaaa';
  const caseDirectory = path.join(directory, caseId);
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({
    caseId,
    quiz: { skinType: 'dry' },
    images: [{ angle: 'front', mediaType: 'image/jpeg', base64: '/9j/AA==' }],
  }));
  let requestBody;
  const output = path.join(directory, 'selected-case.json');
  const previousExitCode = process.exitCode;
  try {
    const report = await main(['--mode', 'count', '--case-id', caseId, '--language', 'he', '--input-dir', directory, '--output', output], {
      getToken: () => 'TEST_TOKEN',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(init.body);
        return response({ inputTokens: 1_000 });
      },
    });
    assert.equal(report.status, 'counted');
    assert.equal(report.caseId, caseId);
    assert.equal(report.language, 'he');
    assert.equal(report.imageCount, 1);
    const content = requestBody.input.converse.messages.flatMap(message => message.content);
    assert.deepEqual(content.find(part => part.image)?.image, { format: 'jpeg', source: { bytes: '/9j/AA==' } });
    assert.equal(content.filter(part => part.image).length, 1);
    assert.deepEqual(requestBody.input.converse.additionalModelRequestFields.output_config.format.schema.properties.shelfAnalysis, { type: 'null' });
    assert.equal(report.schemaAwareCount, true);
    assert.equal(report.countMethod, 'bedrock-runtime-converse-native-schema-v1');
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('Mantle CountTokens fails closed for selected cases before any provider call', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-mantle-photo-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseId = 'case-bbbbbbbbbb';
  const caseDirectory = path.join(directory, caseId);
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId, quiz: {},
    images: [{ angle: 'front', mediaType: 'image/jpeg', base64: '/9j/AA==' }] }));
  let fetchCalled = false;
  const previousExitCode = process.exitCode;
  try {
    await assert.rejects(main(['--mode', 'count', '--count-api', 'anthropic-mantle', '--case-id', caseId,
      '--input-dir', directory, '--output', path.join(directory, 'count.json')], {
      getToken: () => 'TEST_TOKEN', fetchImpl: async () => { fetchCalled = true; return response({ input_tokens: 1_000 }); },
    }), /schema-aware count mode requires/);
    assert.equal(fetchCalled, false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('input token estimate reserves one cent and caps output at 8000 tokens', () => {
  assert.equal(INPUT_COUNT_ALLOWANCE_TOKENS, 128);
  assert.equal(maxOutputTokens(1), 8_000);
  const count = 40_000;
  const outputLimit = maxOutputTokens(count);
  assert.ok(outputLimit > 0);
  const estimatedUpperCost = ((count + INPUT_COUNT_ALLOWANCE_TOKENS) * 5.5 + outputLimit * 27.5) / 1_000_000;
  assert.ok(estimatedUpperCost <= 0.25 - 0.01);
  assert.ok(estimatedUpperCost + 27.5 / 1_000_000 > 0.25 - 0.01);
  assert.equal(maxOutputTokens(50_000), 0);
  assert.equal(maxOutputTokens(0), 0);
  assert.equal(maxOutputTokens(0.5), 0);
});

test('cost is computed at Standard rates and unknown cache pricing stays unknown', () => {
  assert.equal(reportedCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 33);
  assert.equal(reportedCostUsd({ inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 1 }), null);
  assert.equal(reportedCostUsd({ inputTokens: 1, outputTokens: -1 }), null);
});

test('CountTokens uses native regional Converse shape and bearer auth without exposing response data', async () => {
  let request;
  const converse = { system: [{ text: 'private prompt' }], messages: [{ role: 'user', content: [{ text: 'private input' }] }] };
  const additionalModelRequestFields = { output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } };
  const counted = await countTokens({ converse, additionalModelRequestFields, token: 'test-token', fetchImpl: async (url, init) => {
    request = { url, init };
    return response({ inputTokens: 42 });
  } });
  assert.equal(request.url, `${BASE_URL}/model/${COUNT_MODEL}/count-tokens`);
  assert.equal(request.init.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(request.init.body), { input: { converse: { ...converse, additionalModelRequestFields } } });
  assert.equal(counted.inputTokens, 42);
  await assert.rejects(countTokens({ converse: { system: [], messages: [] }, token: 'test-token', fetchImpl: async () => response({ inputTokens: 0 }) }), /count_unavailable/);
});

test('Mantle fallback CountTokens uses the Anthropic count endpoint and API key headers', async () => {
  let request;
  const counted = await countTokens({ api: 'anthropic-mantle', converse: {
    system: [{ text: 'private system' }], messages: [{ role: 'user', content: [{ text: 'private input' }] }],
  }, token: 'test-token', fetchImpl: async (url, init) => {
    request = { url, init };
    return response({ input_tokens: 87 });
  } });
  assert.equal(request.url, MANTLE_COUNT_URL);
  assert.equal(request.init.headers['x-api-key'], 'test-token');
  assert.equal(request.init.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(JSON.parse(request.init.body), { model: COUNT_MODEL, system: 'private system', messages: [{ role: 'user', content: 'private input' }] });
  assert.equal(counted.inputTokens, 87);
});

test('provider failure categorization accepts capitalized and nested messages without retaining their text', async () => {
  for (const body of [
    { Message: 'You are not authorized. PRIVATE_PROVIDER_DETAIL PRIVATE_TOKEN' },
    { error: { message: 'You are not authorized. PRIVATE_PROVIDER_DETAIL PRIVATE_TOKEN' } },
  ]) {
    await assert.rejects(countTokens({ api: 'anthropic-mantle', converse: { system: [], messages: [] }, token: 'PRIVATE_TOKEN',
      fetchImpl: async () => response(body, 403) }), error => {
      assert.equal(error.reason, 'permission_denied');
      assert.equal(JSON.stringify(error).includes('PRIVATE_PROVIDER_DETAIL'), false);
      assert.equal(String(error).includes('PRIVATE_TOKEN'), false);
      return true;
    });
  }
});

test('non-200 response records only fixed category and status, never provider body text', async () => {
  await assert.rejects(requestJson({ operation: 'converse', body: {}, token: 'test-token', fetchImpl: async () => response({ message: 'PRIVATE_PROVIDER_DETAIL' }, 403) }), error => {
    assert.equal(error.category, 'access');
    assert.equal(error.status, 403);
    assert.equal(String(error).includes('PRIVATE_PROVIDER_DETAIL'), false);
    return true;
  });
});

test('analysis sends selected output cap and treats unknown cache usage as cost-unknown', async () => {
  let body;
  const converse = { system: [{ text: 'system' }], messages: [{ role: 'user', content: [{ text: 'prompt' }] }], outputConfig: { textFormat: { type: 'json_schema', structure: { jsonSchema: { name: 'skin_analysis', schema: '{}' } } } } };
  const result = await infer({ converse, token: 'test-token', maxTokens: 321, fetchImpl: async (_url, init) => {
    body = JSON.parse(init.body);
    return response({ output: { message: { content: [{ text: '{"ok":true}' }] } }, usage: { inputTokens: 20, outputTokens: 10, cacheReadInputTokens: 1 }, stopReason: 'end_turn' });
  } });
  assert.equal(result.costUsd, null);
  assert.equal(body.inferenceConfig.maxTokens, 321);
  assert.equal(body.outputConfig.textFormat.type, 'json_schema');
});

test('original local schema still rejects constraints omitted from the wire schema', () => {
  const invalid = { era: { era: { id: 'barrier_healing', affirmation: 'test' }, skin_analysis: { summary: 'test', key_insights: [] },
    routine: { am: [], pm: [] }, product_audit: { current_products_assessment: [], most_urgent_gap: null },
    check_in_prompts: [], safety_flags: [], event_prep: null }, srProducts: null, shelfAnalysis: null };
  const errors = validateAjvOutput(invalid);
  assert.ok(errors.some(error => error.keyword === 'minItems' && error.instancePath === '/era/routine/am'));
});

test('count report cannot supply a different model or enlarge the recomputed output budget', () => {
  const count = { mode: 'count', status: 'counted', countApi: 'bedrock-runtime', promptSha256: 'fingerprint', model: MODEL, countModel: COUNT_MODEL,
    countMethod: 'bedrock-runtime-converse-native-schema-v1', schemaAwareCount: true,
    region: 'us-east-1', inputTokens: 10_000, outputTokenLimit: maxOutputTokens(10_000) };
  assert.equal(verifyCountReport(count, 'fingerprint'), true);
  assert.equal(verifyCountReport({ ...count, countApi: 'anthropic-mantle' }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, countApi: 'unknown' }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, countMethod: 'legacy-text-only' }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, schemaAwareCount: false }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, outputTokenLimit: 8_000 }, 'fingerprint'), false);
  assert.equal(verifyCountReport({ ...count, model: 'different' }, 'fingerprint'), false);
  assert.equal(verifyCountReport(count, 'different'), false);
  const request = { system: [{ text: 'English prompt' }], messages: [{ role: 'user', content: [{ text: 'case quiz' }] }] };
  const fingerprint = promptFingerprint(request);
  const safeCount = { ...count, promptSha256: fingerprint };
  assert.equal(verifyCountReport(safeCount, promptFingerprint({ ...request, system: [{ text: 'Hebrew prompt' }] })), false);
  assert.equal(verifyCountReport(safeCount, promptFingerprint({ ...request, messages: [{ role: 'user', content: [{ image: { format: 'jpeg', source: { bytes: '/9j/AA==' } } }] }] })), false);
});

test('first-body measurement waits for actual bytes and releases its reader', async () => {
  const phases = [];
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array());
    controller.enqueue(new TextEncoder().encode('{"inputTokens":42}'));
    controller.close();
  } });
  await requestJson({ operation: 'count-tokens', token: 'test-token', body: {}, fetchImpl: async () => new Response(body), onPhase: phase => phases.push(phase) });
  assert.deepEqual(phases.map(phase => phase.phase), ['request_start', 'headers', 'first_body', 'body_end']);
  assert.equal(body.locked, false);
});

test('response cost survives invalid generated JSON without retaining provider prose', async () => {
  const result = await infer({ converse: {}, token: 'test-token', maxTokens: 500,
    fetchImpl: async () => response({ output: { message: { content: [{ text: 'PRIVATE_INVALID_JSON' }] } }, usage: { inputTokens: 100, outputTokens: 20 }, stopReason: 'end_turn' }) });
  assert.equal(result.parseError, 'invalid_json');
  assert.equal(result.costUsd, reportedCostUsd({ inputTokens: 100, outputTokens: 20 }));
  assert.equal(JSON.stringify(result).includes('PRIVATE_INVALID_JSON'), false);
});

test('schema-aware CountTokens failure checkpoints before the request and retains safe error phases without leaking inputs', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-probe-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseDirectory = path.join(directory, 'case-568f7d2ab3');
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId: 'case-568f7d2ab3', quiz: { name: 'PRIVATE_QUIZ' }, images: [] }));
  const output = path.join(directory, 'count.json');
  const previousExitCode = process.exitCode;
  try {
    const report = await main(['--mode', 'count', '--input-dir', directory, '--output', output], {
      getToken: () => 'PRIVATE_TOKEN',
      fetchImpl: async (url, init) => {
        const checkpoint = JSON.parse(await fs.readFile(output, 'utf8'));
        assert.equal(checkpoint.status, 'in_flight');
        assert.equal(url, `${BASE_URL}/model/${COUNT_MODEL}/count-tokens`);
        assert.equal(init.headers.Authorization, 'Bearer PRIVATE_TOKEN');
        assert.equal(JSON.parse(init.body).input.converse.additionalModelRequestFields.output_config.format.type, 'json_schema');
        return response({ error: { message: 'You are not authorized to perform this action. PRIVATE_TOKEN PRIVATE_PROVIDER_DETAIL' } }, 403,
          { 'x-amzn-requestid': 'req-safe', 'x-amzn-errortype': 'AccessDeniedException' });
      },
    });
    assert.equal(report.failureReason, 'permission_denied');
    assert.equal(report.exceptionType, 'AccessDeniedException');
    assert.equal(report.httpStatus, 403);
    assert.equal(report.providerRequestId, 'req-safe');
    assert.ok(report.phases.some(phase => phase.phase === 'headers'));
    for (const value of ['PRIVATE_TOKEN', 'PRIVATE_PROVIDER_DETAIL', 'PRIVATE_QUIZ']) assert.equal(JSON.stringify(report).includes(value), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

// Exercise the CLI gates with a real temporary checkpoint and mocked provider; no inference is billed.
test('analysis retains known cost when the original schema rejects the output, and rejects a forged budget before fetching', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-probe-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseDirectory = path.join(directory, 'case-568f7d2ab3');
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId: 'case-568f7d2ab3', quiz: { name: 'PRIVATE_QUIZ' }, images: [] }));
  const countFile = path.join(directory, 'count.json');
  const previousExitCode = process.exitCode;
  try {
    const count = await main(['--mode', 'count', '--input-dir', directory, '--output', countFile], {
      getToken: () => 'PRIVATE_TOKEN', fetchImpl: async () => response({ inputTokens: 10_000 }),
    });
    const args = ['--mode', 'analysis', '--input-dir', directory, '--count-report', countFile];
    const usage = { inputTokens: 100, outputTokens: 20 };
    const rejected = await main([...args, '--output', path.join(directory, 'invalid.json')], {
      getToken: () => 'PRIVATE_TOKEN', fetchImpl: async () => response({ output: { message: { content: [{ text: '{"private":"PRIVATE_OUTPUT"}' }] } }, usage, stopReason: 'end_turn' }),
    });
    assert.equal(rejected.failureCategory, 'validation');
    assert.ok(rejected.schemaErrorCount > 0);
    assert.equal(rejected.costUsd, reportedCostUsd(usage));
    assert.equal(rejected.costUnknown, false);
    assert.equal(JSON.stringify(rejected).includes('PRIVATE_OUTPUT'), false);
    await fs.writeFile(countFile, JSON.stringify({ ...count, outputTokenLimit: count.outputTokenLimit + 1 }));
    let calls = 0;
    const forged = await main([...args, '--output', path.join(directory, 'forged.json')], {
      getToken: () => 'PRIVATE_TOKEN', fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
    });
    assert.equal(forged.failureCategory, 'budget');
    assert.equal(calls, 0);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('deadline aborts a stalled request and records a timeout phase', async () => {
  const phases = [];
  await assert.rejects(requestJson({ operation: 'converse', body: {}, token: 'test-token', timeoutMs: 10,
    onPhase: phase => phases.push(phase), fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  }), error => error.category === 'timeout');
  assert.deepEqual(phases.map(phase => phase.phase), ['request_start', 'timeout']);
});
