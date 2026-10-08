const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMessages, eligibleProducts, outputSchema, validateOutput } = require('./contract.cjs');
const { minimizeQuiz } = require('./extract.cjs');

const catalogue = [
  {
    _id: 'safe-1', name: 'Gentle Cream', category: 'face_creams', use: 'home', pregnancy: 'safe',
    archived: false, keyActives: ['Glycerin'], strengths: [], suitableFor: ['Sensitive skin'],
    ingredients: 'Water, Glycerin, Ceramide',
  },
  {
    _id: 'unknown-preg-1', name: 'Night Active', category: 'face_serums', use: 'home', pregnancy: 'not_stated',
    archived: false, keyActives: ['Retinyl Palmitate'], strengths: [], suitableFor: [],
    ingredients: 'Water, Retinyl Palmitate',
  },
  {
    _id: 'pro-1', name: 'Clinic Peel', category: 'cleansers_peelings', use: 'professional', pregnancy: 'safe',
    archived: false, keyActives: [], strengths: [], suitableFor: [], ingredients: 'Water',
  },
  {
    _id: 'archived-1', name: 'Old Cream', category: 'face_creams', use: 'home', pregnancy: 'safe',
    archived: true, keyActives: [], strengths: [], suitableFor: [], ingredients: 'Water',
  },
];

function validOutput() {
  return {
    era: {
      era: { id: 'barrier_healing', affirmation: 'I can care for my skin gently.' },
      skin_analysis: {
        summary: 'Your answers suggest that a gentle, consistent routine may support comfort.',
        key_insights: [{ title: 'Keep it simple', body: 'Introduce one product at a time and stop if irritation occurs.' }],
      },
      routine: {
        am: [{ category: 'cleansers_peelings', instruction: 'Use a gentle cleanser, then apply moisturizer.' }],
        pm: [{ category: 'face_creams', instruction: 'Cleanse gently and apply a small amount of moisturizer.' }],
      },
      product_audit: {
        current_products_assessment: [{
          product_type: 'moisturizer', verdict: 'replace', note: 'A simple fragrance-free option may be easier to assess.',
          suggested_replacement: 'Gentle Cream', suggested_replacement_product_id: 'safe-1',
        }],
        most_urgent_gap: 'moisturizer',
      },
      check_in_prompts: ['Did the routine feel comfortable after one week?'],
      safety_flags: ['Patch test a new product and stop if irritation develops.'],
      event_prep: null,
    },
    srProducts: {
      bundle_note: 'Start with a short routine.',
      era_hero_product: { sr_product_id: 'safe-1', sr_product_name: 'Gentle Cream', hero_reason: 'It is the only matching home product in this snapshot.' },
      am: [{ step: 1, routine_category: 'face_creams', sr_product_id: 'safe-1', sr_product_name: 'Gentle Cream',
        key_actives_matched: ['Glycerin'], use_instruction: 'Apply a small amount.', match_reason: 'Matches the need for a simple moisturizer.', no_match_note: '' }],
      pm: [{ step: 1, routine_category: 'face_creams', sr_product_id: 'safe-1', sr_product_name: 'Gentle Cream',
        key_actives_matched: ['Glycerin'], use_instruction: 'Apply after cleansing.', match_reason: 'A simple option for evening use.', no_match_note: '' }],
    },
    shelfAnalysis: null,
  };
}

test('strict schema keeps all top-level fields and limits Era IDs', () => {
  assert.equal(outputSchema.additionalProperties, false);
  assert.deepEqual(outputSchema.required, ['era', 'srProducts', 'shelfAnalysis']);
  assert.deepEqual(outputSchema.properties.era.properties.era.properties.id.enum, [
    'barrier_healing', 'acne_reset', 'burnout_recovery', 'glow_building', 'repair_restore',
  ]);
});

test('message builder excludes identifying quiz fields and filters unsafe catalogue items', () => {
  const { system, messages } = buildMessages({
    quiz: {
      name: 'Private Name', email: 'person@example.test', birthday: '01/02/1990', pregnancy_caution: true,
      age: '25-34', gender: 'she', tone: 'III', concerns: ['dryness'], diabetes: 'no', diabetes_caution: false,
      event: 'wedding', smoke: 'no',
      allergies: ['none'],
    },
    language: 'en', images: [], catalogue,
  });
  const content = messages[0].content[0].text;
  assert.match(system, /Do not diagnose/);
  assert.match(content, /No images were provided/);
  assert.doesNotMatch(content, /Private Name|person@example\.test|01\/02\/1990/);
  assert.match(content, /"age":"25-34"/);
  assert.match(content, /"gender":"she"/);
  assert.match(content, /"concerns":\["dryness"\]/);
  assert.match(content, /"diabetes":"no"/);
  assert.match(content, /"diabetes_caution":false/);
  assert.match(content, /"event":"wedding"/);
  assert.deepEqual(eligibleProducts(catalogue, { pregnancy_caution: true }).map(item => item._id), ['safe-1']);
});

test('message builder retains normalized legacy assessment fields from the exporter', () => {
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

test('missing pregnancy answers stay distinct from an explicit no answer', () => {
  const absent = minimizeQuiz({ gender: 'she' }, new Date('2026-10-08T00:00:00.000Z'));
  const explicitNo = minimizeQuiz({ pregnant: 'no' }, new Date('2026-10-08T00:00:00.000Z'));
  const parseRequest = quiz => {
    const text = buildMessages({ quiz, language: 'en', images: [], catalogue: [] }).messages[0].content[0].text;
    return JSON.parse(text.replace('Evaluation input JSON:\n', '')).quiz;
  };
  assert.equal(Object.hasOwn(parseRequest(absent), 'pregnancy_caution'), false);
  assert.equal(parseRequest(explicitNo).pregnancy_caution, false);
});

test('semantics accept the known-ID EN result and reject a fabricated product ID', () => {
  const output = validOutput();
  assert.deepEqual(validateOutput(output, { quiz: {}, language: 'en', images: [] }, catalogue).errors, []);
  output.srProducts.am[0].sr_product_id = 'not-in-catalogue';
  assert.ok(validateOutput(output, { quiz: {}, language: 'en', images: [] }, catalogue).errors
    .some(error => error.includes('outside the eligible catalogue')));
});

test('semantic validation rejects pregnancy-ineligible products and exact allergy matches', () => {
  const output = validOutput();
  output.srProducts.era_hero_product = {
    sr_product_id: 'unknown-preg-1', sr_product_name: 'Night Active', hero_reason: 'A night option.',
  };
  let errors = validateOutput(output, { quiz: { pregnant_or_ttc: 'yes' }, language: 'en' }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('outside the eligible catalogue')));

  output.srProducts.era_hero_product = {
    sr_product_id: 'safe-1', sr_product_name: 'Gentle Cream', hero_reason: 'A gentle option.',
  };
  errors = validateOutput(output, { quiz: { allergies: ['ceramide'] }, language: 'en' }, catalogue).errors;
  assert.ok(errors.some(error => error.includes('contains a listed allergy')));
});

test('null allergy answers do not become fake allergies and required prose cannot be empty', () => {
  const output = validOutput();
  const withoutIngredients = catalogue.map(product => ({ ...product, ingredients: '' }));
  const noAllergies = validateOutput(output, {
    quiz: { allergies: null, allergies_other: undefined }, language: 'en', images: [],
  }, withoutIngredients).errors;
  assert.ok(!noAllergies.some(error => error.includes('allergy answers')));

  output.era.skin_analysis.summary = '   ';
  output.era.routine.am[0].instruction = '';
  const emptyText = validateOutput(output, { quiz: {}, language: 'en', images: [] }, catalogue).errors;
  assert.ok(emptyText.includes('skin analysis summary must not be empty'));
  assert.ok(emptyText.some(error => error.includes('AM routine step 1 instruction must not be empty')));
});

test('language validator catches English prose when Hebrew was requested', () => {
  const output = validOutput();
  assert.ok(validateOutput(output, { quiz: {}, language: 'he' }, catalogue).errors
    .some(error => error.includes('requested language')));
});

test('missing photos are explicit and image labels are attached to image payloads', () => {
  const noPhotos = buildMessages({ quiz: {}, language: 'he', images: [], catalogue: [] }).messages[0].content;
  assert.match(noPhotos[0].text, /No images were provided/);

  const withPhoto = buildMessages({
    quiz: {}, language: 'he', images: [{ angle: 'front', mediaType: 'image/jpeg', base64: 'ZmFrZQ==' }], catalogue: [],
  }).messages[0].content;
  assert.equal(withPhoto[1].text, 'Photo angle: front.');
  assert.equal(withPhoto[2].type, 'image_url');
  assert.match(withPhoto[2].image_url.url, /^data:image\/jpeg;base64,/);

  const inventedShelf = validOutput();
  inventedShelf.shelfAnalysis = {
    identified_products: [], shelf_summary: { overall_note: 'No visible products.' },
    transition_plan: { first_sr_purchase: '', first_sr_purchase_product_id: null },
  };
  assert.ok(validateOutput(inventedShelf, { quiz: {}, language: 'en', images: [] }, catalogue).errors
    .some(error => error.includes('shelfAnalysis must be null')));
});
