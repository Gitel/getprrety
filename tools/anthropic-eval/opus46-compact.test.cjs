'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Ajv = require('ajv');
const { outputSchema, validateOutput, eligibleProducts } = require('../../server/services/anthropic/analysisContract');
const { loadSeedCatalogue: loadCatalogue } = require('../../server/services/anthropic/catalogue');
const { makeWireSchema, validateAjvOutput, main, reportedCostUsd } = require('./opus46.cjs');
const { COMPACT_CONTRACT_VERSION, makeCompactWireSchema, hydrateCompactOutput } = require('./opus46-compact.cjs');

const catalogue = loadCatalogue();
const quiz = { allergies: ['none'], irritants: ['nothing'], pregnant_or_ttc: 'no' };
const eligible = eligibleProducts(catalogue, quiz);
const products = {
  moisturizer: eligible.find(product => product.category === 'face_creams'),
  secondMoisturizer: eligible.find(product => product.category === 'face_creams' && product._id !== eligible.find(item => item.category === 'face_creams')?._id),
  cleanser: eligible.find(product => product.category === 'cleansers_peelings' && /cleanser|cleansing/i.test(product.name)),
};
assert.ok(products.moisturizer && products.secondMoisturizer && products.cleanser);

function canonicalOutput(language = 'en') {
  const he = language === 'he';
  const text = he ? {
    summary: 'העור שלך יכול להיעזר בשגרה פשוטה ועדינה.', insight: 'תמיכה במחסום העור', body: 'שמירה על לחות עשויה לעזור.', safety: 'הפסיקי להשתמש אם מתפתח גירוי.',
  } : {
    summary: 'Your skin may benefit from a simple, gentle routine.', insight: 'Support the skin barrier', body: 'Maintaining moisture may help.', safety: 'Stop use if irritation develops.',
  };
  const step = (number, category, product, explanation) => ({
    step: number, category_id: category, routine_category: ({ cleanse: he ? 'ניקוי' : 'Cleanse', moisturize: he ? 'לחות' : 'Moisturize', protect: he ? 'הגנה' : 'Protect' })[category],
    sr_product_id: product?._id ?? null, sr_product_name: product?.name ?? '',
    key_actives_matched: product?.keyActives?.slice(0, 2) ?? [], use_instruction: 'Use as directed.',
    match_reason: product ? explanation : '', no_match_note: product ? '' : explanation,
  });
  return {
    era: {
      era: { id: 'barrier_healing', affirmation: he ? 'אעניק לעור שלי טיפול עדין.' : 'I will care for my skin gently.' },
      skin_analysis: { summary: text.summary, key_insights: [{ title: text.insight, body: text.body }] },
      routine: {
        am: [
          { category_id: 'cleanse', category: he ? 'ניקוי' : 'Cleanse', instruction: he ? 'נקי בעדינות.' : 'Cleanse gently.' },
          { category_id: 'moisturize', category: he ? 'לחות' : 'Moisturize', instruction: he ? 'מרחי קרם לחות.' : 'Apply moisturizer.' },
          { category_id: 'protect', category: he ? 'הגנה' : 'Protect', instruction: he ? 'השתמשי במסנן קרינה SPF 30 ומעלה.' : 'Use broad-spectrum SPF 30 or higher.' },
        ],
        pm: [
          { category_id: 'cleanse', category: he ? 'ניקוי' : 'Cleanse', instruction: he ? 'נקי בעדינות.' : 'Cleanse gently.' },
          { category_id: 'moisturize', category: he ? 'לחות' : 'Moisturize', instruction: he ? 'מרחי קרם לחות.' : 'Apply moisturizer.' },
        ],
      },
      product_audit: { current_products_assessment: [{
        product_type: he ? 'קרם לחות' : 'moisturizer', verdict: 'replace', note: he ? 'בחרי חלופה עדינה.' : 'Choose a gentler alternative.',
        suggested_replacement: products.moisturizer.name, suggested_replacement_product_id: products.moisturizer._id,
      }], most_urgent_gap: null },
      check_in_prompts: [], safety_flags: [text.safety], event_prep: null,
    },
    srProducts: {
      bundle_note: he ? 'ערכה פשוטה ועדינה.' : 'A simple, gentle set.',
      era_hero_product: { sr_product_id: products.moisturizer._id, sr_product_name: products.moisturizer.name, hero_reason: text.body },
      am: [step(1, 'cleanse', products.cleanser, text.body), step(2, 'moisturize', products.moisturizer, text.body), step(3, 'protect', null, he ? 'רכשי מסנן קרינה בנפרד.' : 'Source sunscreen separately.')],
      pm: [step(1, 'cleanse', products.cleanser, text.body), step(2, 'moisturize', products.secondMoisturizer, text.body)],
    },
    shelfAnalysis: {
      identified_products: [{
        status: 'compatible', brand: 'Visible Brand', product_name: 'Photo-identified cream', category: 'face_creams',
        status_reason: text.body, use_instruction: text.body, sr_substitute_name: products.moisturizer.name,
        sr_substitute_product_id: products.moisturizer._id,
      }],
      shelf_summary: { overall_note: text.summary },
      transition_plan: { first_sr_purchase: products.moisturizer.name, first_sr_purchase_product_id: products.moisturizer._id },
    },
  };
}

function compactOutput(canonical) {
  // Simulate the exact field reductions in the wire contract, retaining semantic text and stable IDs.
  const wire = structuredClone(canonical);
  for (const period of ['am', 'pm']) for (const step of wire.era.routine[period]) delete step.category;
  for (const item of wire.era.product_audit.current_products_assessment) delete item.suggested_replacement;
  delete wire.srProducts.era_hero_product.sr_product_name;
  for (const period of ['am', 'pm']) for (const step of wire.srProducts[period]) {
    delete step.step;
    delete step.routine_category;
    delete step.sr_product_name;
    step.explanation = step.sr_product_id ? step.match_reason : step.no_match_note;
    delete step.match_reason;
    delete step.no_match_note;
  }
  for (const item of wire.shelfAnalysis.identified_products) delete item.sr_substitute_name;
  delete wire.shelfAnalysis.transition_plan.first_sr_purchase;
  // Model-only empty values avoid expensive nullable grammar branches. Hydration
  // must restore these without changing any of the canonical content above.
  for (const item of wire.era.product_audit.current_products_assessment) {
    if (item.suggested_replacement_product_id === null) item.suggested_replacement_product_id = '';
  }
  if (wire.era.product_audit.most_urgent_gap === null) wire.era.product_audit.most_urgent_gap = '';
  if (wire.era.event_prep === null) wire.era.event_prep = { summary: '', steps: [] };
  if (wire.srProducts.era_hero_product.sr_product_id === null) wire.srProducts.era_hero_product.sr_product_id = '';
  for (const period of ['am', 'pm']) for (const step of wire.srProducts[period]) {
    if (step.sr_product_id === null) step.sr_product_id = '';
  }
  for (const item of wire.shelfAnalysis.identified_products) {
    if (item.sr_substitute_product_id === null) item.sr_substitute_product_id = '';
  }
  if (wire.shelfAnalysis.transition_plan.first_sr_purchase_product_id === null) {
    wire.shelfAnalysis.transition_plan.first_sr_purchase_product_id = '';
  }
  return wire;
}

// Inject the shared Anthropic adapter boundaries so evaluator tests stay offline and inspect the exact request.
function mockCountTokens(inputTokens = 10_000, inspect = () => {}) {
  return async request => { await inspect(request); return { inputTokens }; };
}

function mockComplete(output, usage, inspect = () => {}) {
  return async options => {
    await inspect(options);
    options.onEvent({ phase: 'counted', inputTokens: 10_000, outputTokenLimit: options.maxOutputTokens });
    options.onEvent({ phase: 'usage', usage, costUsd: reportedCostUsd(usage) });
    options.onEvent({ phase: 'complete', finishReason: 'end_turn' });
    // The real provider is constrained by context-pruned sections, including
    // event_prep=null when the synthetic test case did not supply an event.
    const result = structuredClone(output);
    if (options.wireSchema.properties.era.properties.event_prep.type === 'null') result.era.event_prep = null;
    return result;
  };
}

const compactSchema = makeCompactWireSchema(makeWireSchema(outputSchema));
const validateCompact = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(compactSchema);

test('compact schema is immutable, smaller, and excludes server-restored labels/numbering', () => {
  const before = structuredClone(outputSchema);
  const generic = makeWireSchema(outputSchema);
  const compact = makeCompactWireSchema(generic);
  assert.equal(COMPACT_CONTRACT_VERSION, 'anthropic-compact-v3');
  assert.deepEqual(outputSchema, before);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(generic)));
  assert.ok(compact.$defs.srStep.required.includes('explanation'));
  assert.equal('category' in compact.$defs.routineStep.properties, false);
  assert.ok(compact.$defs.routineStep.required.includes('category_id'));
  assert.equal('category' in compact.$defs.routineStep.required, false);
  assert.equal('routine_category' in compact.$defs.srStep.properties, false);
  assert.equal(compact.$defs.srStep.required.includes('routine_category'), false);
  for (const key of ['step', 'sr_product_name', 'match_reason', 'no_match_note']) assert.equal(key in compact.$defs.srStep.properties, false);
  assert.equal('suggested_replacement' in compact.properties.era.properties.product_audit.properties.current_products_assessment.items.properties, false);
  assert.equal('sr_product_name' in compact.properties.srProducts.properties.era_hero_product.properties, false);
  assert.equal('sr_substitute_name' in compact.properties.shelfAnalysis.properties.identified_products.items.properties, false);
  assert.equal('first_sr_purchase' in compact.properties.shelfAnalysis.properties.transition_plan.properties, false);
  assert.deepEqual(compact.properties.era.properties.safety_flags, generic.properties.era.properties.safety_flags);
  assert.deepEqual(compact.properties.era.properties.routine, generic.properties.era.properties.routine);
  const invalid = compactOutput(canonicalOutput());
  invalid.era.routine.am[0].category = 'model-invented-label';
  assert.equal(validateCompact(invalid), false);
});

test('English compact response hydrates exact names and step order then passes canonical/schema/semantic validation', () => {
  const output = canonicalOutput('en');
  const wire = compactOutput(output);
  assert.equal(validateCompact(wire), true);
  const hydrated = hydrateCompactOutput(wire, { eligibleProducts: eligible, language: 'en' });
  assert.deepEqual(hydrated, output);
  assert.deepEqual(validateAjvOutput(hydrated), []);
  assert.deepEqual(validateOutput(hydrated, { quiz, language: 'en', images: [{ angle: 'shelf' }] }, catalogue).errors, []);
  assert.deepEqual(hydrated.era.safety_flags, output.era.safety_flags);
  assert.equal(hydrated.era.routine.am.at(-1).category_id, 'protect');
  assert.deepEqual(hydrated.srProducts.am.map(step => step.step), [1, 2, 3]);
  assert.equal(hydrated.srProducts.am[2].no_match_note, 'Source sunscreen separately.');
  assert.equal(hydrated.shelfAnalysis.identified_products[0].product_name, 'Photo-identified cream');
});

test('Hebrew compact response keeps localized explanations and canonical fields after hydration', () => {
  const output = canonicalOutput('he');
  const wire = compactOutput(output);
  assert.equal(validateCompact(wire), true);
  const hydrated = hydrateCompactOutput(wire, { eligibleProducts: eligible, language: 'he' });
  assert.deepEqual(validateAjvOutput(hydrated), []);
  assert.deepEqual(validateOutput(hydrated, { quiz, language: 'he', images: [{ angle: 'shelf' }] }, catalogue).errors, []);
  assert.equal(hydrated.era.safety_flags[0], output.era.safety_flags[0]);
  assert.deepEqual(hydrated.era.routine.am.map(step => step.category), ['ניקוי', 'לחות', 'הגנה']);
  assert.deepEqual(hydrated.era.routine.pm.map(step => step.category), ['ניקוי', 'לחות']);
  assert.deepEqual(hydrated.srProducts.am.map(step => step.routine_category), ['ניקוי', 'לחות', 'הגנה']);
  assert.equal(hydrated.srProducts.am[0].match_reason, output.srProducts.am[0].match_reason);
  assert.equal(hydrated.srProducts.am[2].no_match_note, output.srProducts.am[2].no_match_note);
});

test('hydration rejects unknown, malformed, and ineligible catalogue IDs without echoing them', () => {
  const mutations = [
    output => { output.era.product_audit.current_products_assessment[0].suggested_replacement_product_id = 'unknown-id'; },
    output => { output.srProducts.era_hero_product.sr_product_id = ' '; },
    output => { output.srProducts.am[1].sr_product_id = 'archived-or-ineligible'; },
    output => { output.shelfAnalysis.transition_plan.first_sr_purchase_product_id = 17; },
  ];
  for (const mutate of mutations) {
    const wire = compactOutput(canonicalOutput());
    mutate(wire);
    assert.throws(() => hydrateCompactOutput(wire, { eligibleProducts: eligible }), error => {
      assert.equal(error.message, 'compact_response_invalid_catalogue_id');
      return true;
    });
  }
});

test('null catalogue IDs restore canonical null/empty values and non-replacement audit nulls', () => {
  const output = canonicalOutput();
  output.era.product_audit.current_products_assessment[0] = {
    product_type: 'cleanser', verdict: 'keep', note: 'Continue if comfortable.',
    suggested_replacement: null, suggested_replacement_product_id: null,
  };
  output.srProducts.era_hero_product.sr_product_id = null;
  output.srProducts.era_hero_product.sr_product_name = '';
  output.srProducts.am[1].sr_product_id = null;
  output.srProducts.am[1].sr_product_name = '';
  output.srProducts.am[1].match_reason = '';
  output.srProducts.am[1].no_match_note = 'No eligible moisturizer match is available.';
  output.shelfAnalysis.identified_products[0].sr_substitute_product_id = null;
  output.shelfAnalysis.identified_products[0].sr_substitute_name = '';
  output.shelfAnalysis.transition_plan.first_sr_purchase_product_id = null;
  output.shelfAnalysis.transition_plan.first_sr_purchase = '';
  const hydrated = hydrateCompactOutput(compactOutput(output), { eligibleProducts: eligible });
  assert.equal(hydrated.era.product_audit.current_products_assessment[0].suggested_replacement, null);
  assert.equal(hydrated.srProducts.era_hero_product.sr_product_name, '');
  assert.equal(hydrated.srProducts.am[1].sr_product_name, '');
  assert.equal(hydrated.shelfAnalysis.identified_products[0].sr_substitute_name, '');
  assert.equal(hydrated.shelfAnalysis.transition_plan.first_sr_purchase, '');
  assert.deepEqual(hydrated, output);
});

test('full compact grammar has no nullable unions and preserves all content sections and enums', () => {
  function check(node) {
    if (!node || typeof node !== 'object') return;
    assert.equal(Array.isArray(node.type), false);
    assert.equal('anyOf' in node, false);
    for (const value of Object.values(node)) check(value);
  }
  check(compactSchema);
  assert.equal(compactSchema.properties.srProducts.type, 'object');
  assert.equal(compactSchema.properties.shelfAnalysis.type, 'object');
  assert.equal(compactSchema.properties.era.properties.event_prep.type, 'object');
  assert.deepEqual(compactSchema.properties.era.properties.era.properties.id.enum, outputSchema.properties.era.properties.era.properties.id.enum);
  assert.deepEqual(compactSchema.$defs.routineStep.properties.category_id.enum, outputSchema.$defs.routineStep.properties.category_id.enum);
});

test('event and shelf content round-trip exactly while absent optional sections restore null', () => {
  const canonical = canonicalOutput();
  canonical.era.event_prep = { summary: 'Prepare gently for your event.', steps: [{ when: 'Before the event', action: 'Keep the routine consistent.' }] };
  const wire = compactOutput(canonical);
  assert.equal(validateCompact(wire), true);
  assert.deepEqual(hydrateCompactOutput(wire, { eligibleProducts: eligible }), canonical);
  wire.era.event_prep = { summary: '', steps: [] };
  wire.srProducts = { bundle_note: '', era_hero_product: { sr_product_id: '', hero_reason: '' }, am: [], pm: [] };
  wire.shelfAnalysis = { identified_products: [], shelf_summary: { overall_note: '' }, transition_plan: { first_sr_purchase_product_id: '' } };
  assert.equal(validateCompact(wire), true);
  const hydrated = hydrateCompactOutput(wire, { eligibleProducts: eligible });
  assert.equal(hydrated.era.event_prep, null);
  assert.equal(hydrated.srProducts, null);
  assert.equal(hydrated.shelfAnalysis, null);
  assert.deepEqual(hydrated.era.skin_analysis, canonical.era.skin_analysis);
  assert.deepEqual(hydrated.era.safety_flags, canonical.era.safety_flags);
  // A useful uncertainty note must survive even when no product can be identified.
  wire.shelfAnalysis.shelf_summary.overall_note = 'The packaging is too blurred to identify.';
  assert.equal(hydrateCompactOutput(wire, { eligibleProducts: eligible }).shelfAnalysis.shelf_summary.overall_note, wire.shelfAnalysis.shelf_summary.overall_note);
});

test('empty-value hydration does not bypass product, routine, or evidence validation', () => {
  const wire = compactOutput(canonicalOutput());
  wire.era.product_audit.current_products_assessment[0].suggested_replacement_product_id = '';
  wire.srProducts.am[2].sr_product_id = products.moisturizer._id;
  wire.era.routine.am = wire.era.routine.am.slice(0, 2);
  const hydrated = hydrateCompactOutput(wire, { eligibleProducts: eligible });
  const errors = validateOutput(hydrated, { quiz, language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('replacement requires')));
  assert.ok(errors.some(error => error.includes('core protect')));
  assert.ok(errors.some(error => error.includes('no catalogue SPF')));
  assert.ok(errors.some(error => error.includes('no shelf photos')));
  const before = structuredClone(hydrated);
  wire.srProducts.am[0].sr_product_id = products.moisturizer._id;
  assert.throws(() => hydrateCompactOutput(wire, { eligibleProducts: [] }), /compact_response_invalid_catalogue_id/);
  assert.deepEqual(hydrated, before);
});

test('a stale core-three count fingerprint is rejected before a paid request and leaves a durable gate record', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-compact-stale-count-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseId = 'case-compact-stale';
  const caseDirectory = path.join(directory, caseId);
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId, quiz, images: [] }));
  const countFile = path.join(directory, 'count.json');
  const resultFile = path.join(directory, 'analysis.json');
  const previousExitCode = process.exitCode;
  try {
    const count = await main(['--mode', 'count', '--case-id', caseId, '--input-dir', directory, '--output', countFile], {
      getToken: () => 'test-token', countTokensImpl: mockCountTokens(),
    });
    assert.equal(count.status, 'counted');
    await fs.writeFile(countFile, JSON.stringify({ ...count, promptSha256: 'old-core3-prompt-fingerprint' }));
    let paidCalls = 0;
    const analysis = await main(['--mode', 'analysis', '--case-id', caseId, '--input-dir', directory,
      '--count-report', countFile, '--output', resultFile], {
      getToken: () => 'test-token', countTokensImpl: mockCountTokens(), completeImpl: async () => { paidCalls += 1; throw new Error('must not call'); },
    });
    assert.equal(analysis.failureCategory, 'budget');
    assert.equal(analysis.automaticRetries, 0);
    assert.equal(paidCalls, 0);
    assert.equal((await fs.readFile(resultFile, 'utf8')).includes('old-core3-prompt-fingerprint'), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('empty eligible catalogue removes SR schema, accepts only null SR output, and keeps valid analysis quality and cost', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-compact-empty-catalogue-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseId = 'case-compact-empty-catalogue';
  const caseDirectory = path.join(directory, caseId);
  // An unresolved allergy label safely excludes every catalogue item for this fixture.
  const emptyQuiz = { allergies: ['unmapped-allergy'], irritants: ['nothing'], pregnant_or_ttc: 'no' };
  assert.deepEqual(eligibleProducts(catalogue, emptyQuiz), []);
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId, quiz: emptyQuiz, images: [] }));
  const countFile = path.join(directory, 'count.json');
  const resultFile = path.join(directory, 'analysis.json');
  const previousExitCode = process.exitCode;
  const usage = { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
  try {
    const count = await main(['--mode', 'count', '--case-id', caseId, '--input-dir', directory, '--output', countFile], {
      getToken: () => 'test-token', countTokensImpl: mockCountTokens(10_000, request => {
        const schema = request.wireSchema;
        assert.deepEqual(schema.properties.srProducts, { type: 'null' });
        assert.equal(Object.hasOwn(schema.$defs, 'srStep'), false);
      }),
    });
    const output = compactOutput(canonicalOutput());
    output.srProducts = null;
    output.shelfAnalysis = null;
    output.era.product_audit.current_products_assessment = [];
    output.era.product_audit.most_urgent_gap = '';
    const analysis = await main(['--mode', 'analysis', '--case-id', caseId, '--input-dir', directory,
      '--count-report', countFile, '--output', resultFile], {
      getToken: () => 'test-token', completeImpl: mockComplete(output, usage),
    });
    assert.equal(count.status, 'counted');
    assert.equal(analysis.status, 'valid');
    assert.equal(analysis.promptSha256, count.promptSha256);
    assert.equal(analysis.costUsd, reportedCostUsd(usage));
    assert.equal(analysis.costUnknown, false);
    assert.ok(analysis.qualityMetrics && typeof analysis.qualityMetrics === 'object');
    assert.equal(analysis.wireSchemaErrorCount, 0);
    assert.equal(analysis.canonicalSchemaErrorCount, 0);
    assert.equal(analysis.semanticErrorCount, 0);
    assert.equal(JSON.parse(await fs.readFile(resultFile, 'utf8')).status, 'valid');

    const noCatalogueValidator = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true })
      .compile(makeCompactWireSchema(makeWireSchema(outputSchema), { hasEligibleProducts: false }));
    const invalid = compactOutput(canonicalOutput());
    invalid.shelfAnalysis = null;
    assert.equal(noCatalogueValidator(invalid), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('analysis checkpoints in-flight status before fetch and retains reported cost if ID hydration fails', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-compact-hydration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseId = 'case-compact-hydrate';
  const caseDirectory = path.join(directory, caseId);
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId, quiz, images: [] }));
  const countFile = path.join(directory, 'count.json');
  const resultFile = path.join(directory, 'analysis.json');
  const previousExitCode = process.exitCode;
  try {
    const count = await main(['--mode', 'count', '--case-id', caseId, '--input-dir', directory, '--output', countFile], {
      getToken: () => 'test-token', countTokensImpl: mockCountTokens(),
    });
    const wire = compactOutput(canonicalOutput());
    wire.srProducts.era_hero_product.sr_product_id = 'unknown-private-id';
    wire.shelfAnalysis = null;
    const usage = { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
    let checkpointSeen = false;
    const analysis = await main(['--mode', 'analysis', '--case-id', caseId, '--input-dir', directory,
      '--count-report', countFile, '--output', resultFile], {
      getToken: () => 'test-token',
      completeImpl: mockComplete(wire, usage, async options => {
        const checkpoint = JSON.parse(await fs.readFile(resultFile, 'utf8'));
        checkpointSeen = checkpoint.status === 'in_flight' && checkpoint.costUnknown === true
          && checkpoint.automaticRetries === 0 && checkpoint.compactContractVersion === COMPACT_CONTRACT_VERSION;
        assert.ok(options.system.includes('numeric step field'));
      }),
    });
    assert.equal(count.status, 'counted');
    assert.equal(checkpointSeen, true);
    assert.equal(analysis.failureCategory, 'validation');
    assert.equal(analysis.hydrationErrorCount, 1);
    assert.equal(analysis.costUsd, reportedCostUsd(usage));
    assert.equal(analysis.costUnknown, false);
    assert.deepEqual(analysis.usage, usage);
    assert.equal(JSON.stringify(analysis).includes('unknown-private-id'), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('successful compact analysis returns a valid hydrated result, quality metrics, and known cost', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus-compact-success-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caseId = 'case-compact-success';
  const caseDirectory = path.join(directory, caseId);
  await fs.mkdir(caseDirectory);
  await fs.writeFile(path.join(caseDirectory, 'case.json'), JSON.stringify({ caseId, quiz, images: [] }));
  const countFile = path.join(directory, 'count.json');
  const resultFile = path.join(directory, 'analysis.json');
  const previousExitCode = process.exitCode;
  const usage = { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
  try {
    await main(['--mode', 'count', '--case-id', caseId, '--input-dir', directory, '--output', countFile], {
      getToken: () => 'test-token', countTokensImpl: mockCountTokens(),
    });
    const wire = compactOutput(canonicalOutput());
    // The no-photo inference schema requires shelfAnalysis to remain null.
    wire.shelfAnalysis = null;
    const analysis = await main(['--mode', 'analysis', '--case-id', caseId, '--input-dir', directory,
      '--count-report', countFile, '--output', resultFile], {
      getToken: () => 'test-token',
      completeImpl: mockComplete(wire, usage),
    });
    assert.equal(analysis.status, 'valid');
    assert.equal(Object.hasOwn(analysis, 'failureCategory'), false);
    assert.ok(analysis.qualityMetrics && typeof analysis.qualityMetrics === 'object');
    assert.equal(analysis.costUsd, reportedCostUsd(usage));
    assert.equal(analysis.costUnknown, false);
    assert.equal(analysis.wireSchemaErrorCount, 0);
    assert.equal(analysis.canonicalSchemaErrorCount, 0);
    assert.equal(analysis.semanticErrorCount, 0);
    const saved = JSON.parse(await fs.readFile(resultFile, 'utf8'));
    assert.equal(saved.status, 'valid');
    assert.ok(saved.qualityMetrics && typeof saved.qualityMetrics === 'object');
    assert.equal(Object.hasOwn(saved, 'output'), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});
