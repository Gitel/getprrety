const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const contract = require('./contract.cjs');
const { buildMessages, eligibleProducts, eligibilityLimitations, outputSchema, sanitizeQuiz, validateOutput } = contract;
const { minimizeQuiz } = require('./extract.cjs');

// Product-selection tests use explicit answers; incomplete-context behavior is tested separately.
const completeSafety = (answers = {}) => ({ allergies: ['none'], irritants: ['nothing'], pregnant_or_ttc: 'no', ...answers });

const catalogue = [
  { _id: 'cream-1', name: 'Gentle Cream', category: 'face_creams', use: 'home', pregnancy: 'safe', archived: false,
    keyActives: ['Glycerin'], strengths: [], suitableFor: ['Sensitive skin'], ingredients: 'Water, Glycerin, Ceramide' },
  { _id: 'spf-1', name: 'Daily SPF', category: 'face_creams', use: 'home', pregnancy: 'safe', archived: false,
    keyActives: [], strengths: [], suitableFor: [], ingredients: 'Water, Zinc Oxide' },
  { _id: 'citric-1', name: 'Citric Toner', category: 'face_serums', use: 'home', pregnancy: 'safe', archived: false,
    keyActives: ['Citric Acid'], strengths: [], suitableFor: [], ingredients: 'Water, Citric Acid' },
  { _id: 'retinoid-1', name: 'Night Active', category: 'face_serums', use: 'home', pregnancy: 'not_stated', archived: false,
    keyActives: ['Retinyl Palmitate'], strengths: [], suitableFor: [], ingredients: 'Water, Retinyl Palmitate' },
  { _id: 'no-ingredients', name: 'Unknown Cream', category: 'face_creams', use: 'home', pregnancy: 'safe', archived: false,
    keyActives: [], strengths: [], suitableFor: [], ingredients: '' },
  { _id: 'pro-1', name: 'Clinic Peel', category: 'cleansers_peelings', use: 'professional', pregnancy: 'safe', archived: false,
    keyActives: [], strengths: [], suitableFor: [], ingredients: 'Water' },
  { _id: 'archived-1', name: 'Old Cream', category: 'face_creams', use: 'home', pregnancy: 'safe', archived: true,
    keyActives: [], strengths: [], suitableFor: [], ingredients: 'Water' },
];

const unmatched = (category_id, step) => ({ step, category_id, routine_category: category_id, sr_product_id: null,
  sr_product_name: '', key_actives_matched: [], use_instruction: '', match_reason: '',
  no_match_note: `No eligible ${category_id} product is available in the catalogue.` });

function validOutput() {
  return {
    era: {
      era: { id: 'barrier_healing', affirmation: 'I can care for my skin gently.' },
      skin_analysis: { summary: 'Your answers suggest a gentle, consistent routine may support comfort.',
        key_insights: [{ title: 'Keep it simple', body: 'Introduce one product at a time and stop if irritation occurs.' }] },
      routine: { am: [
        { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
        { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
        { category_id: 'protect', category: 'Sun protection', instruction: 'Apply broad-spectrum sunscreen.' },
      ], pm: [
        { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
        { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
      ] },
      product_audit: { current_products_assessment: [{ product_type: 'moisturizer', verdict: 'replace',
        note: 'A simple option may be easier to assess.', suggested_replacement: 'Gentle Cream', suggested_replacement_product_id: 'cream-1' }],
        most_urgent_gap: 'sun protection' },
      check_in_prompts: ['Did the routine feel comfortable after one week?'],
      safety_flags: ['Patch test a new product and stop if irritation develops.'], event_prep: null,
    },
    srProducts: { bundle_note: 'Start with a short routine.',
      era_hero_product: { sr_product_id: 'cream-1', sr_product_name: 'Gentle Cream', hero_reason: 'A simple moisturizer option.' },
      am: [unmatched('cleanse', 1), { ...unmatched('moisturize', 2), no_match_note: '', sr_product_id: 'cream-1',
        sr_product_name: 'Gentle Cream', use_instruction: 'Apply moisturizer.', match_reason: 'Supports moisture.' },
      unmatched('protect', 3)],
      pm: [unmatched('cleanse', 1), { ...unmatched('moisturize', 2), no_match_note: '', sr_product_id: 'cream-1',
        sr_product_name: 'Gentle Cream', use_instruction: 'Apply after cleansing.', match_reason: 'Matches the need for a simple moisturizer.' }],
    },
    shelfAnalysis: null,
  };
}

test('production server and evaluator share the same prompt and schema contract', () => {
  assert.equal(require('../../server/services/anthropic/analysisContract'), contract);
  assert.equal(outputSchema.additionalProperties, false);
  assert.deepEqual(outputSchema.required, ['era', 'srProducts', 'shelfAnalysis']);
  assert.deepEqual(outputSchema.properties.era.properties.era.properties.id.enum,
    ['barrier_healing', 'acne_reset', 'burnout_recovery', 'glow_building', 'repair_restore']);
  assert.deepEqual(outputSchema.$defs.routineStep.properties.category_id.enum, ['cleanse', 'treat', 'moisturize', 'protect', 'other']);
  const validate = new Ajv({ allErrors: true, strict: true }).compile(outputSchema);
  assert.equal(validate(validOutput()), true, JSON.stringify(validate.errors));
  assert.deepEqual(validateOutput(validOutput(), { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors, []);
});

test('message builder excludes identifying fields and only includes eligible home products', () => {
  const { system, messages } = buildMessages({ quiz: {
    name: 'Private Name', email: 'person@example.test', birthday: '01/02/1990', pregnancy_caution: true,
    age: '25-34', gender: 'she', concerns: ['dryness'], allergies: ['none'], irritants: ['nothing'],
  }, language: 'en', images: [], catalogue });
  const requestText = messages[0].content[0].text;
  const request = JSON.parse(requestText.replace('Evaluation input JSON:\n', ''));
  assert.match(system, /category IDs and order must exactly cover/i);
  assert.doesNotMatch(requestText, /Private Name|person@example\.test|01\/02\/1990/);
  assert.deepEqual(request.eligible_catalogue.map(product => product.id), ['cream-1', 'spf-1', 'citric-1', 'no-ingredients']);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ pregnant_or_ttc: 'yes' })).map(item => item._id), ['cream-1', 'spf-1', 'citric-1', 'no-ingredients']);
});

test('legacy quiz fields exported from existing analyses remain available to the shared contract', () => {
  const quiz = minimizeQuiz({
    name: 'Private Name', email: 'person@example.test', birthday: '01/02/1990', identity: 'they',
    age: '25-34', fitzpatrick: 'III', current_products: ['cleanser'], concerns: ['dryness'],
  }, new Date('2026-10-08T00:00:00.000Z'));
  const content = buildMessages({ quiz, language: 'en', images: [], catalogue: [] }).messages[0].content[0].text;
  assert.match(content, /"identity":"they"/);
  assert.match(content, /"fitzpatrick":"III"/);
  assert.match(content, /"current_products":\["cleanser"\]/);
  assert.match(content, /"age":"25-34"/);
  assert.doesNotMatch(content, /Private Name|person@example\.test|01\/02\/1990/);
});

test('route and prompt share a whitelist sanitizer that preserves legacy answer values', () => {
  assert.deepEqual(sanitizeQuiz({
    name: 'Private Name', birthday: '01/02/1990', identity: 'they', fitzpatrick: 'III',
    current_products: ['cleanser'], age: '25-34', extra: 'drop me',
  }), { identity: 'they', fitzpatrick: 'III', current_products: ['cleanser'], age: '25-34' });
  const legacyHormoneAnswer = sanitizeQuiz({ hormones: { trying_to_conceive: 'yes' } });
  assert.deepEqual(legacyHormoneAnswer, { pregnancy_caution: true });
  assert.ok(eligibleProducts(catalogue, completeSafety(legacyHormoneAnswer)).every(product => product.pregnancy === 'safe'));
});

test('quiz sanitizer rejects oversized values, nested payload objects, non-finite values, and inherited keys', () => {
  const invalid = value => assert.throws(() => sanitizeQuiz(value), /INVALID_INPUT/);
  invalid({ allergies_other: 'x'.repeat(241) });
  invalid({ skin_goals: Array(31).fill('dryness') });
  invalid({ skin_goals: [{ secret: 'private' }] });
  invalid({ age: Number.NaN });
  invalid({ stress: 11 });
  invalid(Object.assign(Object.create({ skin_goals: ['inherited'] }), { gender: 'she' }));
  invalid({ hormones: { pregnant: 'yes', secret: 'private' } });
  assert.deepEqual(sanitizeQuiz({ age: 31, stress: 4, fitzpatrick: 3, event_type: 'wedding', allergies: ['none'] }),
    { age: 31, stress: 4, fitzpatrick: 3, event_type: 'wedding', allergies: ['none'] });
});

test('missing and single-hormone negative answers stay incomplete while an aggregate no is complete', () => {
  const absent = minimizeQuiz({ gender: 'she' }, new Date('2026-10-08T00:00:00.000Z'));
  const explicitNo = minimizeQuiz({ pregnant: 'no' }, new Date('2026-10-08T00:00:00.000Z'));
  const requestQuiz = quiz => JSON.parse(buildMessages({ quiz, language: 'en', images: [], catalogue }).messages[0].content[0].text
    .replace('Evaluation input JSON:\n', '')).quiz;
  assert.equal(Object.hasOwn(requestQuiz(absent), 'pregnancy_caution'), false);
  assert.equal(Object.hasOwn(requestQuiz(explicitNo), 'pregnancy_caution'), false);
  assert.deepEqual(eligibleProducts(catalogue, absent), []);
  assert.deepEqual(eligibleProducts(catalogue, { allergies: ['none'], irritants: ['nothing'], pregnant: 'no' }), []);
  assert.ok(eligibleProducts(catalogue, completeSafety({ pregnant_or_ttc: 'no' })).some(product => product._id === 'retinoid-1'));
  assert.ok(eligibleProducts(catalogue, completeSafety({ pregnant_or_ttc: 'yes' })).every(product => product.pregnancy === 'safe'));
});

test('catalogue picks require explicit allergy, irritant, and pregnancy answers', () => {
  const partial = [
    {},
    { allergies: ['none'], irritants: ['nothing'] },
    { allergies: [], irritants: ['nothing'], pregnant_or_ttc: 'no' },
    { allergies: ['none'], irritants: [''], pregnant_or_ttc: 'no' },
    { allergies: ['none'], irritants: ['nothing'], pregnant_or_ttc: 'maybe' },
  ];
  for (const quiz of partial) assert.deepEqual(eligibleProducts(catalogue, quiz), []);

  // A positive answer remains a caution even when another required safety answer is missing.
  const positiveButPartial = { allergies: ['none'], pregnant_or_ttc: 'yes' };
  assert.equal(contract.isPregnancyCaution(positiveButPartial), true);
  assert.deepEqual(eligibleProducts(catalogue, positiveButPartial), []);
  assert.match(eligibilityLimitations(positiveButPartial).join(' '), /answers are incomplete/i);

  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ pregnant_or_ttc: true })).map(item => item._id),
    ['cream-1', 'spf-1', 'citric-1', 'no-ingredients']);

  const incompleteBuild = buildMessages({ quiz: { allergies: ['none'], irritants: ['nothing'] }, catalogue });
  const incompleteMessage = incompleteBuild.messages[0].content[0].text;
  const request = JSON.parse(incompleteMessage.replace('Evaluation input JSON:\n', ''));
  assert.deepEqual(request.eligible_catalogue, []);
  assert.match(request.product_selection_limitations.join(' '), /answers are incomplete/i);
  assert.match(incompleteBuild.system, /routine/i);
});

test('broad allergies and missing ingredient lists prevent confident product selection', () => {
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ allergies: ['cosmetics'] })), []);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ allergies: ['allergic to cosmetics / skincare'] })), []);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ allergies: ['ceramide'] })).map(item => item._id), ['spf-1', 'citric-1', 'retinoid-1']);
  const built = buildMessages({ quiz: { allergies: ['cosmetics'] }, catalogue });
  const request = JSON.parse(built.messages[0].content[0].text.replace('Evaluation input JSON:\n', ''));
  assert.equal(request.eligible_catalogue.length, 0);
  assert.match(request.product_selection_limitations.join(' '), /broad allergy answer/i);
});

test('controlled allergy and irritant aliases cover fragrance, AHA/BHA, retinoids, and sulfates', () => {
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ allergies: ['fragrance'] })).map(item => item._id), ['cream-1', 'spf-1', 'citric-1', 'retinoid-1']);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ irritants: ['acids'] })).map(item => item._id), ['cream-1', 'spf-1', 'retinoid-1']);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ ahas_bhas: true })).map(item => item._id), ['cream-1', 'spf-1', 'retinoid-1']);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ has_bhas: true })).map(item => item._id), ['cream-1', 'spf-1', 'citric-1', 'retinoid-1']);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ allergies: ['ahas_bhas'] })).map(item => item._id), ['cream-1', 'spf-1', 'retinoid-1']);
  const fragranced = [...catalogue, { ...catalogue[0], _id: 'fragranced-1', ingredients: 'Water, Parfum' }];
  assert.ok(!eligibleProducts(fragranced, completeSafety({ allergies_other: 'fragrance sensitivity' })).some(item => item._id === 'fragranced-1'));
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ retinoids: true })).map(item => item._id), ['cream-1', 'spf-1', 'citric-1']);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ sulfates: true })).map(item => item._id), ['cream-1', 'spf-1', 'citric-1', 'retinoid-1']);
  const seedSulfateProduct = { ...catalogue[0], _id: 'seed-sulfate', ingredients: 'Water, Sodium Coceth Sulfate' };
  assert.ok(!eligibleProducts([seedSulfateProduct], completeSafety({ sulfates: true })).length,
    'the actual seeded Sodium Coceth Sulfate ingredient must match the sulfate irritant class');
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ irritants: ['nothing'] })).map(item => item._id),
    eligibleProducts(catalogue, completeSafety()).map(item => item._id));
});

test('free-text known labels map to ingredient aliases and unresolved labels block picks', () => {
  const peppermint = { ...catalogue[0], _id: 'peppermint-1', ingredients: 'Water, PeppermintLeafExtract' };
  assert.ok(!eligibleProducts([peppermint], completeSafety({ allergies_other: 'peppermint sensitivity' })).length);
  assert.ok(!eligibleProducts([peppermint], completeSafety({ irritants_other: 'peppermint sensitivity' })).length);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ allergies_other: 'unknown botanical sensitivity' })), []);
  assert.match(eligibilityLimitations({ allergies_other: 'unknown botanical sensitivity' }).join(' '), /could not be mapped/i);
  assert.deepEqual(eligibleProducts(catalogue, completeSafety({ irritants_other: 'unknown ingredient sensitivity' })), []);
  assert.match(eligibilityLimitations({ irritants_other: 'unknown ingredient sensitivity' }).join(' '), /could not be mapped/i);
});

test('generic routine puts cleansing first, treatment before moisturizer, and AM protection last', () => {
  const output = validOutput();
  output.era.routine.am = [
    { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
    { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
    { category_id: 'protect', category: 'Sun protection', instruction: 'Apply sunscreen.' },
  ];
  let errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('AM routine must start with cleanse')));

  output.era.routine.am = [
    { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
    { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
    { category_id: 'treat', category: 'Treatment', instruction: 'Apply treatment.' },
    { category_id: 'protect', category: 'Sun protection', instruction: 'Apply sunscreen.' },
  ];
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('AM treatment must come before moisturize')));

  output.era.routine.am = [
    { category_id: 'cleanse', category: 'Cleanser', instruction: 'Cleanse gently.' },
    { category_id: 'protect', category: 'Sun protection', instruction: 'Apply sunscreen.' },
    { category_id: 'moisturize', category: 'Moisturizer', instruction: 'Apply moisturizer.' },
  ];
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('AM routine must end with protect')));
});

test('generic cleanser and SPF coverage, category order, and duplicates are checked', () => {
  const output = validOutput();
  output.srProducts.am = [];
  let errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('category/order coverage')));

  output.srProducts.am = validOutput().srProducts.am;
  output.srProducts.am = [unmatched('cleanse', 1), { ...unmatched('moisturize', 2), no_match_note: '',
    sr_product_id: 'cream-1', sr_product_name: 'Gentle Cream' }];
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('category/order coverage'))); // Reproduces the prior response that omitted SPF.

  output.srProducts.am = [unmatched('protect', 1), unmatched('cleanse', 2)];
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('category/order coverage')));

  output.srProducts.am = validOutput().srProducts.am;
  output.srProducts.am[1].step = 3;
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('step number must match its routine position')));

  output.era.routine.pm.push({ category_id: 'cleanse', category: 'Second cleanser', instruction: 'Cleanse again.' });
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('routine repeats category cleanse')));
});

test('unmatched cleanser and sunscreen require a useful note and no product name or ID', () => {
  const output = validOutput();
  output.srProducts.am[0].no_match_note = '';
  let errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('useful no_match_note')));
  output.srProducts.am[0].sr_product_name = 'Invented cleanser';
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('product name without a catalogue id')));

  const sunscreen = output.srProducts.am[2];
  sunscreen.sr_product_id = 'spf-1'; sunscreen.sr_product_name = 'Daily SPF'; sunscreen.no_match_note = '';
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('no catalogue SPF value is verified')));

  output.srProducts.am[0].sr_product_id = '';
  output.srProducts.am[0].sr_product_name = '';
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('has an empty catalogue ID')));
});

test('routine product categories reject clear cleanser and moisturizer mismatches', () => {
  const cleanser = { _id: 'seed-cleanser', seedKey: 'seed-cleanser', name: 'Herbal Cleansing Mousse',
    category: 'cleansers_peelings', use: 'home', pregnancy: 'safe', ingredients: 'Water' };
  const peel = { _id: 'seed-peel', seedKey: 'seed-peel', name: 'Whitening Peeling Acid',
    category: 'cleansers_peelings', use: 'home', pregnancy: 'safe', ingredients: 'Water, Glycolic Acid' };
  const catalogueWithCleanser = [...catalogue, cleanser, peel];
  const output = validOutput();
  output.srProducts.am[0] = { ...output.srProducts.am[0], sr_product_id: 'cream-1',
    sr_product_name: 'Gentle Cream', no_match_note: '' };
  let errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogueWithCleanser).errors;
  assert.ok(errors.some(error => error.includes('not compatible with cleanse')));

  output.srProducts.am[0] = { ...unmatched('cleanse', 1), sr_product_id: 'seed-peel',
    sr_product_name: 'Whitening Peeling Acid', no_match_note: '' };
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogueWithCleanser).errors;
  assert.ok(errors.some(error => error.includes('not compatible with cleanse')));

  output.srProducts.am[0] = { ...unmatched('cleanse', 1) };
  output.srProducts.am[1] = { ...output.srProducts.am[1], sr_product_id: 'seed-cleanser',
    sr_product_name: 'Herbal Cleansing Mousse', no_match_note: '' };
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogueWithCleanser).errors;
  assert.ok(errors.some(error => error.includes('not compatible with moisturize')));

  output.srProducts.am[1] = { ...output.srProducts.am[1], sr_product_id: 'citric-1',
    sr_product_name: 'Citric Toner', no_match_note: '' };
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogueWithCleanser).errors;
  assert.ok(errors.some(error => error.includes('not compatible with moisturize')));
});

test('event preparation must be null when the quiz has no event or marks none', () => {
  const output = validOutput();
  output.era.event_prep = { summary: 'Prepare for your event.', steps: [] };
  assert.ok(validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors
    .some(error => error.includes('event_prep must be null')));
  assert.ok(validateOutput(output, { quiz: { event_type: 'none' }, language: 'en', images: [] }, catalogue).errors
    .some(error => error.includes('event_prep must be null')));
  output.era.event_prep = null;
  assert.ok(!validateOutput(output, { quiz: { event_type: 'wedding' }, language: 'en', images: [] }, catalogue).errors
    .some(error => error.includes('event_prep must be null')));
});

test('audit replacement fields must be null except for a known replacement ID and exact name', () => {
  const output = validOutput();
  const item = output.era.product_audit.current_products_assessment[0];
  item.verdict = 'keep';
  let errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('must have null replacement fields')));
  item.verdict = 'replace'; item.suggested_replacement_product_id = null; item.suggested_replacement = null;
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('replacement requires a known catalogue ID')));
  item.suggested_replacement_product_id = 'cream-1'; item.suggested_replacement = 'Not Gentle Cream';
  errors = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('name does not match its catalogue id')));
});

test('null allergy answers do not create a fake restriction and blank required prose is rejected', () => {
  const output = validOutput();
  const withoutIngredients = catalogue.map(product => ({ ...product, ingredients: '' }));
  const nullAllergies = validateOutput(output, {
    quiz: { allergies: null, allergies_other: undefined }, language: 'en', images: [],
  }, withoutIngredients).errors;
  assert.ok(!nullAllergies.some(error => error.includes('ingredient list is unavailable')));

  output.era.skin_analysis.summary = '   ';
  output.era.routine.am[0].instruction = '';
  const blank = validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors;
  assert.ok(blank.includes('skin analysis summary must not be empty'));
  assert.ok(blank.includes('AM routine step 1 instruction must not be empty'));
});

test('image context labels are retained and shelf analysis requires a shelf image', () => {
  const noPhotos = buildMessages({ quiz: completeSafety(), language: 'he', images: [], catalogue: [] }).messages[0].content;
  assert.match(noPhotos[0].text, /No images were provided/);
  const withShelf = buildMessages({ quiz: completeSafety(), language: 'he', catalogue: [], images: [
    { angle: 'shelf-front', mediaType: 'image/jpeg', base64: 'ZmFrZQ==' },
  ] }).messages[0].content;
  assert.equal(withShelf[1].text, 'Photo angle: shelf-front.');
  assert.equal(withShelf[2].type, 'image_url');

  const output = validOutput();
  output.shelfAnalysis = { identified_products: [], shelf_summary: { overall_note: 'No visible products.' },
    transition_plan: { first_sr_purchase: '', first_sr_purchase_product_id: null } };
  assert.ok(validateOutput(output, { quiz: completeSafety(), language: 'en', images: [] }, catalogue).errors
    .some(error => error.includes('shelfAnalysis must be null')));
  assert.ok(!validateOutput(output, { quiz: completeSafety(), language: 'en', images: [{ angle: 'shelf-front' }] }, catalogue).errors
    .some(error => error.includes('shelfAnalysis must be null')));
});

test('language validation rejects English analysis prose when Hebrew was requested', () => {
  assert.ok(validateOutput(validOutput(), { quiz: completeSafety(), language: 'he' }, catalogue).errors
    .some(error => error.includes('requested language')));
});
