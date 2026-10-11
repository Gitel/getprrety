const fs = require('node:fs');
const path = require('node:path');

const ERA_IDS = ['barrier_healing', 'acne_reset', 'burnout_recovery', 'glow_building', 'repair_restore'];
const ROUTINE_CATEGORY_IDS = ['cleanse', 'treat', 'moisturize', 'protect', 'other'];
const SHELF_CATEGORIES = ['cleansers_peelings', 'face_serums', 'eye', 'face_creams', 'masks'];
const shelfStatuses = ['compatible', 'borderline', 'conflicting', 'unknown'];

// Keep this strict contract deployable by the API server without an evaluation-only dependency.
const outputSchema = {
  type: 'object', additionalProperties: false, required: ['era', 'srProducts', 'shelfAnalysis'],
  properties: {
    era: { type: 'object', additionalProperties: false,
      required: ['era', 'skin_analysis', 'routine', 'product_audit', 'check_in_prompts', 'safety_flags', 'event_prep'],
      properties: {
        era: { type: 'object', additionalProperties: false, required: ['id', 'affirmation'], properties: {
          id: { type: 'string', enum: ERA_IDS }, affirmation: { type: 'string' },
        } },
        skin_analysis: { type: 'object', additionalProperties: false, required: ['summary', 'key_insights'], properties: {
          summary: { type: 'string' }, key_insights: { type: 'array', maxItems: 8, items: {
            type: 'object', additionalProperties: false, required: ['title', 'body'], properties: {
              title: { type: 'string' }, body: { type: 'string' },
            },
          } },
        } },
        routine: { type: 'object', additionalProperties: false, required: ['am', 'pm'], properties: {
          am: { type: 'array', minItems: 3, maxItems: 4, items: { $ref: '#/$defs/routineStep' } },
          pm: { type: 'array', minItems: 2, maxItems: 4, items: { $ref: '#/$defs/routineStep' } },
        } },
        product_audit: { type: 'object', additionalProperties: false, required: ['current_products_assessment', 'most_urgent_gap'], properties: {
          current_products_assessment: { type: 'array', maxItems: 20, items: {
            type: 'object', additionalProperties: false,
            required: ['product_type', 'verdict', 'note', 'suggested_replacement', 'suggested_replacement_product_id'],
            properties: {
              product_type: { type: 'string' }, verdict: { type: 'string', enum: ['keep', 'remove', 'replace', 'missing'] },
              note: { type: 'string' }, suggested_replacement: { type: ['string', 'null'] },
              suggested_replacement_product_id: { type: ['string', 'null'] },
            },
          } },
          most_urgent_gap: { type: ['string', 'null'] },
        } },
        check_in_prompts: { type: 'array', maxItems: 5, items: { type: 'string' } },
        safety_flags: { type: 'array', maxItems: 12, items: { type: 'string' } },
        event_prep: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
          required: ['summary', 'steps'], properties: {
            summary: { type: 'string' }, steps: { type: 'array', maxItems: 8, items: {
              type: 'object', additionalProperties: false, required: ['when', 'action'], properties: {
                when: { type: 'string' }, action: { type: 'string' },
              },
            } },
          },
        }] },
      },
    },
    srProducts: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      required: ['bundle_note', 'era_hero_product', 'am', 'pm'], properties: {
        bundle_note: { type: 'string' }, era_hero_product: { type: 'object', additionalProperties: false,
          required: ['sr_product_id', 'sr_product_name', 'hero_reason'], properties: {
            sr_product_id: { type: ['string', 'null'] }, sr_product_name: { type: 'string' }, hero_reason: { type: 'string' },
          },
        },
        am: { type: 'array', maxItems: 4, items: { $ref: '#/$defs/srStep' } },
        pm: { type: 'array', maxItems: 4, items: { $ref: '#/$defs/srStep' } },
      },
    }] },
    shelfAnalysis: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      required: ['identified_products', 'shelf_summary', 'transition_plan'], properties: {
        identified_products: { type: 'array', maxItems: 30, items: {
          type: 'object', additionalProperties: false,
          required: ['status', 'brand', 'product_name', 'category', 'status_reason', 'use_instruction', 'sr_substitute_name', 'sr_substitute_product_id'],
          properties: {
            status: { type: 'string', enum: shelfStatuses }, brand: { type: 'string' }, product_name: { type: 'string' },
            category: { type: 'string', enum: [...SHELF_CATEGORIES, 'unknown'] }, status_reason: { type: 'string' },
            use_instruction: { type: 'string' }, sr_substitute_name: { type: 'string' },
            sr_substitute_product_id: { type: ['string', 'null'] },
          },
        } },
        shelf_summary: { type: 'object', additionalProperties: false, required: ['overall_note'], properties: { overall_note: { type: 'string' } } },
        transition_plan: { type: 'object', additionalProperties: false, required: ['first_sr_purchase', 'first_sr_purchase_product_id'], properties: {
          first_sr_purchase: { type: 'string' }, first_sr_purchase_product_id: { type: ['string', 'null'] },
        } },
      },
    }] },
  },
  $defs: {
    routineStep: { type: 'object', additionalProperties: false, required: ['category_id', 'category', 'instruction'], properties: {
      category_id: { type: 'string', enum: ROUTINE_CATEGORY_IDS }, category: { type: 'string' }, instruction: { type: 'string' },
    } },
    srStep: { type: 'object', additionalProperties: false,
      required: ['step', 'category_id', 'routine_category', 'sr_product_id', 'sr_product_name', 'key_actives_matched', 'use_instruction', 'match_reason', 'no_match_note'],
      properties: {
        step: { type: 'integer', minimum: 1 }, category_id: { type: 'string', enum: ROUTINE_CATEGORY_IDS },
        routine_category: { type: 'string' }, sr_product_id: { type: ['string', 'null'] }, sr_product_name: { type: 'string' },
        key_actives_matched: { type: 'array', maxItems: 10, items: { type: 'string' } },
        use_instruction: { type: 'string' }, match_reason: { type: 'string' }, no_match_note: { type: 'string' },
      },
    },
  },
};

const QUIZ_KEYS = [
  'age', 'age_range', 'gender', 'identity', 'tone', 'fitzpatrick', 'concerns', 'skin_goals', 'top_concern',
  'post_cleanse_feel', 'irritants', 'irritants_other', 'diagnosed_conditions', 'health_conditions',
  'diabetes', 'has_diabetes', 'diabetes_caution', 'pregnant', 'pregnant_or_ttc', 'pregnancy_caution',
  'allergies', 'allergies_other', 'ahas_bhas', 'has_bhas', 'retinoids', 'sulfates',
  'diagnosed_conditions_other', 'routine_products', 'current_products', 'smoke', 'smokes', 'work_environment',
  'sleep', 'stress', 'water_intake', 'alcohol', 'exercise', 'interests', 'event', 'event_type', 'event_date',
];
const QUIZ_ARRAY_FIELDS = new Set([
  'concerns', 'skin_goals', 'current_products', 'routine_products', 'health_conditions', 'allergies',
  'irritants', 'diagnosed_conditions', 'interests',
]);
const QUIZ_OTHER_FIELDS = new Set(['allergies_other', 'irritants_other', 'diagnosed_conditions_other']);
const QUIZ_BOOLEAN_FIELDS = new Set([
  'pregnancy_caution', 'pregnant', 'pregnant_or_ttc', 'diabetes', 'has_diabetes', 'ahas_bhas', 'has_bhas',
  'diabetes_caution', 'retinoids', 'sulfates',
]);

const IRRITANT_CLASSES = Object.freeze({
  ahas_bhas: ['glycolic acid', 'lactic acid', 'mandelic acid', 'malic acid', 'tartaric acid', 'citric acid', 'salicylic acid', 'betaine salicylate'],
  has_bhas: ['salicylic acid', 'betaine salicylate'],
  retinoids: ['retinol', 'retinal', 'retinaldehyde', 'retinyl palmitate', 'retinoic acid', 'tretinoin', 'adapalene'],
  sulfates: ['sodium lauryl sulfate', 'sodium laureth sulfate', 'ammonium lauryl sulfate', 'ammonium laureth sulfate', 'sodium coceth sulfate'],
  fragrance: ['fragrance', 'parfum', 'perfume', 'essential oil'],
  acids: ['glycolic acid', 'lactic acid', 'mandelic acid', 'malic acid', 'tartaric acid', 'citric acid', 'salicylic acid'],
});
const BROAD_ALLERGY_VALUES = new Set(['cosmetics', 'skincare', 'foods', 'food', 'meds', 'medications', 'medicine', 'sunscreen', 'sunscreens']);
const NON_INGREDIENT_IRRITANTS = new Set(['cold', 'hot_water', 'nothing']);
const INGREDIENT_ALIASES = Object.freeze({
  fragrance: ['fragrance', 'parfum', 'perfume'],
  fragrances: ['fragrance', 'parfum', 'perfume'],
  acids: ['glycolic acid', 'lactic acid', 'mandelic acid', 'malic acid', 'tartaric acid', 'citric acid', 'salicylic acid'],
  ahas_bhas: ['glycolic acid', 'lactic acid', 'mandelic acid', 'malic acid', 'tartaric acid', 'citric acid', 'salicylic acid'],
  has_bhas: ['salicylic acid', 'betaine salicylate'],
  retinoids: ['retinol', 'retinal', 'retinaldehyde', 'retinyl palmitate', 'retinoic acid', 'tretinoin', 'adapalene'],
  sulfates: ['sodium lauryl sulfate', 'sodium laureth sulfate', 'ammonium lauryl sulfate', 'ammonium laureth sulfate', 'sodium coceth sulfate'],
  lanolin: ['lanolin', 'wool wax'],
  iodine: ['iodine', 'potassium iodide'],
  peppermint: ['peppermint', 'mentha piperita', 'peppermint leaf extract', 'peppermintleafextract'],
});

function isPregnancyCaution(quiz = {}) {
  // Missing answers do not activate restrictions; explicit positive legacy and current fields do.
  return quiz.pregnancy_caution === true || quiz.pregnant_or_ttc === 'yes' || quiz.pregnant_or_ttc === true
    || quiz.pregnant === 'yes' || quiz.pregnant === true || quiz.hormones?.pregnant === 'yes'
    || quiz.hormones?.trying_to_conceive === 'yes' || quiz.hormones?.breastfeeding === 'yes';
}

function hasExplicitSafetyAnswer(value) {
  // A visible choice such as "none" is explicit; absent and empty selections are unanswered.
  return (Array.isArray(value) ? value : [value])
    .some(item => typeof item === 'string' && item.trim().length > 0);
}

function hasKnownPregnancyAnswer(quiz = {}) {
  // A single positive is enough for caution, but one negative hormone answer is not an aggregate negative.
  const positive = isPregnancyCaution(quiz);
  const aggregate = quiz.pregnant_or_ttc === 'yes' || quiz.pregnant_or_ttc === 'no'
    || typeof quiz.pregnant_or_ttc === 'boolean'
    || typeof quiz.pregnancy_caution === 'boolean';
  const allHormonesAnswered = ['pregnant', 'trying_to_conceive', 'breastfeeding']
    .every(key => ['yes', 'no', true, false].includes(quiz.hormones?.[key]));
  return positive || aggregate || allHormonesAnswered;
}

function hasCompleteSafetyContext(quiz = {}) {
  return hasExplicitSafetyAnswer(quiz.allergies)
    && hasExplicitSafetyAnswer(quiz.irritants)
    && hasKnownPregnancyAnswer(quiz);
}

function normalizedList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(item => item !== undefined && item !== null).map(item => String(item).trim().toLowerCase())
    .filter(item => item && !['none', 'no', 'no allergies', 'no known allergies', 'nothing'].includes(item));
}

function allergiesFromQuiz(quiz = {}) {
  return [...normalizedList(quiz.allergies), ...normalizedList(quiz.allergies_other)];
}

function activeIrritantClasses(quiz = {}) {
  // Quiz choices can arrive as selected labels or boolean flags, so normalize both forms to reviewed classes.
  const selected = [
    ...normalizedList(quiz.irritants), ...normalizedList(quiz.irritants_other),
    ...['ahas_bhas', 'has_bhas', 'retinoids', 'sulfates'].filter(key => quiz[key] === true || quiz[key] === 'yes'),
    ...normalizedList(quiz.ahas_bhas), ...normalizedList(quiz.has_bhas),
    ...normalizedList(quiz.retinoids), ...normalizedList(quiz.sulfates),
  ];
  return [...new Set(selected.flatMap(value => {
    const key = value.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return IRRITANT_CLASSES[key] ? [key] : [];
  }))];
}

function containsTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function isBroadAllergy(value) {
  return [...BROAD_ALLERGY_VALUES].some(category => containsTerm(value, category));
}

function allergyIngredientTerms(allergy) {
  // Free-text labels such as "fragrance sensitivity" use only the controlled aliases reviewed above.
  const mapped = Object.entries(INGREDIENT_ALIASES)
    .filter(([alias]) => containsTerm(allergy, alias))
    .flatMap(([, terms]) => terms);
  return [...new Set(mapped.length ? mapped : [allergy])];
}

function hasUnresolvedSensitivityLabel(values) {
  return values.some(value => /\b(sensitivity|sensitive|allergy|allergic|intoleran(?:t|ce))\b/i.test(value)
    && allergyIngredientTerms(value).length === 1 && allergyIngredientTerms(value)[0] === value);
}

function hasUnresolvedFreeText(quiz, field) {
  return normalizedList(quiz[field]).some(value => {
    if (NON_INGREDIENT_IRRITANTS.has(value)) return false;
    const terms = allergyIngredientTerms(value);
    return terms.length === 1 && terms[0] === value;
  });
}

function productSafetyIssue(product, quiz = {}) {
  const allergies = allergiesFromQuiz(quiz);
  if (allergies.some(isBroadAllergy)) return 'broad allergy answer prevents confident product selection';
  if (hasUnresolvedSensitivityLabel(allergies) || hasUnresolvedFreeText(quiz, 'allergies_other')) return 'reported sensitivity label cannot be mapped to a catalogue ingredient';
  const reportedIrritants = [...normalizedList(quiz.irritants), ...normalizedList(quiz.irritants_other)]
    .filter(value => !NON_INGREDIENT_IRRITANTS.has(value));
  if (hasUnresolvedSensitivityLabel(reportedIrritants) || hasUnresolvedFreeText(quiz, 'irritants_other')) return 'reported irritant label cannot be mapped to a catalogue ingredient';
  const ingredients = typeof product.ingredients === 'string' ? product.ingredients.trim() : '';
  if ((allergies.length || reportedIrritants.length || activeIrritantClasses(quiz).length) && !ingredients) return 'ingredient list is unavailable for a reported allergy or irritant';
  const normalizedIngredients = ingredients.toLowerCase();
  for (const allergy of allergies) {
    const terms = allergyIngredientTerms(allergy);
    if (terms.some(term => term.length >= 3 && containsTerm(normalizedIngredients, term))) return `ingredient matches reported sensitivity: ${allergy}`;
  }
  for (const irritantClass of activeIrritantClasses(quiz)) {
    if (IRRITANT_CLASSES[irritantClass].some(term => containsTerm(normalizedIngredients, term))) return `ingredient matches reported irritant: ${irritantClass}`;
  }
  for (const irritant of reportedIrritants) {
    const key = irritant.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const terms = IRRITANT_CLASSES[key] || allergyIngredientTerms(irritant);
    if (terms.some(term => containsTerm(normalizedIngredients, term))) return `ingredient matches reported irritant: ${irritant}`;
  }
  return null;
}

function eligibilityLimitations(quiz = {}) {
  const allergies = allergiesFromQuiz(quiz);
  const limits = [];
  if (!hasCompleteSafetyContext(quiz)) {
    limits.push('Allergy, irritant, and pregnancy answers are incomplete; no catalogue product can be confidently selected.');
  }
  if (allergies.some(isBroadAllergy)) limits.push('A broad allergy answer does not identify a specific ingredient; no catalogue product can be confidently selected.');
  if (hasUnresolvedSensitivityLabel(allergies) || hasUnresolvedFreeText(quiz, 'allergies_other')) limits.push('A reported allergy or sensitivity label could not be mapped to a known ingredient; no catalogue product can be confidently selected.');
  const irritants = [...normalizedList(quiz.irritants), ...normalizedList(quiz.irritants_other)]
    .filter(value => !NON_INGREDIENT_IRRITANTS.has(value));
  if (hasUnresolvedSensitivityLabel(irritants) || hasUnresolvedFreeText(quiz, 'irritants_other')) limits.push('A reported irritant label could not be mapped to a known ingredient; no catalogue product can be confidently selected.');
  return limits;
}

function eligibleProducts(catalogue = [], quiz = {}) {
  // Filter uncertain safety matches before building model input so the model cannot select them.
  if (!hasCompleteSafetyContext(quiz)) return [];
  return catalogue.filter(product => product && String(product._id || '').trim()
    && product.use === 'home' && product.archived !== true
    && (!isPregnancyCaution(quiz) || product.pregnancy === 'safe')
    && !productSafetyIssue(product, quiz));
}

function sanitizeQuiz(quiz = {}) {
  // Keep the API route and provider prompt on the same whitelist and accept only the client/exporter value shapes.
  if (!quiz || typeof quiz !== 'object' || Array.isArray(quiz)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(quiz))) throw new Error('INVALID_INPUT');
  const safe = {};
  for (const key of QUIZ_KEYS) {
    if (!Object.hasOwn(quiz, key)) continue;
    const value = quiz[key];
    if (value === undefined || value === null || value === '') continue;
    if (QUIZ_ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(value) || value.length > 30
        || value.some(item => typeof item !== 'string' || item.length > 100)) throw new Error('INVALID_INPUT');
      safe[key] = value;
    } else if (QUIZ_OTHER_FIELDS.has(key)) {
      if (typeof value !== 'string' || value.length > 240) throw new Error('INVALID_INPUT');
      safe[key] = value;
    } else if (QUIZ_BOOLEAN_FIELDS.has(key)) {
      if (typeof value === 'boolean') safe[key] = value;
      else if (typeof value === 'string' && value.length <= 100) safe[key] = value;
      else throw new Error('INVALID_INPUT');
    } else if (typeof value === 'string') {
      if (value.length > (key === 'age' ? 20 : 100)) throw new Error('INVALID_INPUT');
      safe[key] = value;
    } else if (['age', 'stress', 'fitzpatrick'].includes(key) && typeof value === 'number' && Number.isFinite(value)) {
      const inRange = key === 'age' ? value >= 0 && value <= 129
        : key === 'stress' ? value >= 1 && value <= 10
          : value >= 1 && value <= 6;
      if (!inRange) throw new Error('INVALID_INPUT');
      safe[key] = value;
    } else {
      throw new Error('INVALID_INPUT');
    }
  }
  // Older clients stored pregnancy answers under hormones; preserve the positive caution without forwarding that object.
  if (Object.hasOwn(quiz, 'hormones') && quiz.hormones !== null) {
    const hormoneKeys = ['pregnant', 'trying_to_conceive', 'breastfeeding'];
    if (typeof quiz.hormones !== 'object' || Array.isArray(quiz.hormones)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(quiz.hormones))
      || Object.keys(quiz.hormones).some(key => !hormoneKeys.includes(key))
      || hormoneKeys.some(key => quiz.hormones[key] !== undefined && !['yes', 'no', 'not_answered'].includes(quiz.hormones[key]))) {
      throw new Error('INVALID_INPUT');
    }
  }
  if (quiz.hormones?.pregnant === 'yes' || quiz.hormones?.trying_to_conceive === 'yes' || quiz.hormones?.breastfeeding === 'yes') {
    safe.pregnancy_caution = true;
  }
  return safe;
}

function buildMessages({ quiz = {}, language = 'en', images = [], catalogue = [] } = {}) {
  const lang = String(language).toLowerCase().startsWith('he') ? 'he' : 'en';
  const products = eligibleProducts(catalogue, quiz).map(product => ({
    id: String(product._id), name: String(product.name || '').slice(0, 120), category: product.category || 'unknown',
    pregnancy: product.pregnancy || 'not_stated',
    keyActives: (Array.isArray(product.keyActives) ? product.keyActives : []).slice(0, 12).map(item => String(item).slice(0, 80)),
    strengths: (Array.isArray(product.strengths) ? product.strengths : []).slice(0, 8).map(item => String(item).slice(0, 80)),
    suitableFor: (Array.isArray(product.suitableFor) ? product.suitableFor : []).slice(0, 8).map(item => String(item).slice(0, 100)),
    ingredients: typeof product.ingredients === 'string' ? product.ingredients.slice(0, 1800) : '',
  }));
  const photoParts = [];
  for (const image of images) {
    if (!image?.base64 || !image?.mediaType) continue;
    photoParts.push({ type: 'text', text: `Photo angle: ${image.angle || 'unspecified'}.` });
    photoParts.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } });
  }
  const noPhotos = photoParts.length === 0;
  const request = {
    language: lang === 'he' ? 'Hebrew' : 'English', quiz: sanitizeQuiz(quiz),
    image_context: noPhotos ? 'No images were provided. Do not make visual observations or identify shelf products.'
      : 'Use only visible evidence from each labelled image. State uncertainty; never infer a diagnosis from a photo.',
    eligible_catalogue: products, product_selection_limitations: eligibilityLimitations(quiz),
  };
  return {
    system: fs.readFileSync(path.join(__dirname, 'analysisPrompt.md'), 'utf8'),
    messages: [{ role: 'user', content: [{ type: 'text', text: `Evaluation input JSON:\n${JSON.stringify(request)}` }, ...photoParts] }],
  };
}

function collectText(output) {
  const root = output?.era || {};
  const analysis = root.skin_analysis || {};
  const strings = [analysis.summary, root.era?.affirmation, root.check_in_prompts, root.safety_flags, root.product_audit?.most_urgent_gap];
  for (const insight of analysis.key_insights || []) strings.push(insight?.title, insight?.body);
  for (const item of root.product_audit?.current_products_assessment || []) strings.push(item?.product_type, item?.note);
  for (const step of [...(root.routine?.am || []), ...(root.routine?.pm || [])]) strings.push(step?.category, step?.instruction);
  strings.push(root.event_prep?.summary);
  for (const step of root.event_prep?.steps || []) strings.push(step?.when, step?.action);
  if (output?.srProducts) {
    strings.push(output.srProducts.bundle_note, output.srProducts.era_hero_product?.hero_reason);
    for (const step of [...(output.srProducts.am || []), ...(output.srProducts.pm || [])])
      strings.push(step?.routine_category, step?.use_instruction, step?.match_reason, step?.no_match_note);
  }
  if (output?.shelfAnalysis) {
    strings.push(output.shelfAnalysis.shelf_summary?.overall_note);
    for (const product of output.shelfAnalysis.identified_products || []) strings.push(product?.status_reason, product?.use_instruction);
  }
  return strings.flat(Infinity).filter(value => typeof value === 'string').join(' ');
}

function textHasRequestedLanguage(output, language) {
  const text = collectText(output);
  const letters = text.match(/[A-Za-z\u0590-\u05ff]/g) || [];
  if (!letters.length) return false;
  const target = language === 'he' ? (text.match(/[\u0590-\u05ff]/g) || []).length : (text.match(/[A-Za-z]/g) || []).length;
  return target / letters.length >= (language === 'he' ? 0.35 : 0.65);
}

function routineProductCategoryCompatible(step, product) {
  // The saved cleansers_peelings category mixes peels and cleansers; only explicit cleanser wording supports a cleanse step.
  if (step.category_id === 'cleanse') {
    return product.category === 'cleansers_peelings' && /cleanser|cleansing/i.test(String(product.name || ''));
  }
  // A cleanser/peel catalogue category cannot substantiate a moisturizing routine step.
  if (step.category_id === 'moisturize') return product.category === 'face_creams';
  return true;
}

function hasNoEvent(quiz) {
  const event = String(quiz.event_type || quiz.event || '').trim().toLowerCase();
  return !event || ['none', 'no_event', 'no event'].includes(event);
}

function validateOutput(output, caseData = {}, catalogue = []) {
  const errors = [];
  const quiz = caseData.quiz || caseData;
  const language = String(caseData.language || 'en').toLowerCase().startsWith('he') ? 'he' : 'en';
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { errors: ['output must be a JSON object'] };
  if (!ERA_IDS.includes(output.era?.era?.id)) errors.push('era.era.id must be a known app Era id');
  if (!textHasRequestedLanguage(output, language)) errors.push(`generated prose does not match requested language: ${language}`);
  if (typeof output.era?.skin_analysis?.summary !== 'string' || !output.era.skin_analysis.summary.trim()) errors.push('skin analysis summary must not be empty');
  if (hasNoEvent(quiz) && output.era?.event_prep != null) errors.push('event_prep must be null when no event was supplied');

  for (const period of ['am', 'pm']) {
    const steps = output.era?.routine?.[period] || [];
    const seen = new Set();
    const expectedCore = period === 'am' ? ['cleanse', 'moisturize', 'protect'] : ['cleanse', 'moisturize'];
    for (const category of expectedCore) {
      if (!steps.some(step => step?.category_id === category)) errors.push(`${period.toUpperCase()} routine is missing the core ${category} step`);
    }
    steps.forEach((step, index) => {
      if (!ROUTINE_CATEGORY_IDS.includes(step?.category_id)) errors.push(`${period.toUpperCase()} routine step ${index + 1} has an unknown category_id`);
      if (seen.has(step?.category_id)) errors.push(`${period.toUpperCase()} routine repeats category ${step?.category_id}`);
      seen.add(step?.category_id);
      if (typeof step?.instruction !== 'string' || !step.instruction.trim()) errors.push(`${period.toUpperCase()} routine step ${index + 1} instruction must not be empty`);
    });
    if (steps.length && steps[0]?.category_id !== 'cleanse') errors.push(`${period.toUpperCase()} routine must start with cleanse`);
    const treatmentIndex = steps.findIndex(step => step?.category_id === 'treat');
    const moisturizerIndex = steps.findIndex(step => step?.category_id === 'moisturize');
    if (treatmentIndex >= 0 && moisturizerIndex >= 0 && treatmentIndex > moisturizerIndex) {
      errors.push(`${period.toUpperCase()} treatment must come before moisturize`);
    }
    if (period === 'am' && steps.length && steps.at(-1)?.category_id !== 'protect') {
      errors.push('AM routine must end with protect');
    }
  }

  const eligible = eligibleProducts(catalogue, quiz);
  const byId = new Map(eligible.map(product => [String(product._id), product]));
  const checkProduct = (id, name, label) => {
    if (id === '') { errors.push(`${label} has an empty catalogue ID`); return; }
    if (!id) { if (name) errors.push(`${label} has a product name without a catalogue id`); return; }
    const product = byId.get(String(id));
    if (!product) { errors.push(`${label} references a product outside the eligible catalogue`); return; }
    if (String(name || '').trim().toLowerCase() !== String(product.name || '').trim().toLowerCase()) errors.push(`${label} name does not match its catalogue id`);
  };

  const assessment = output.era?.product_audit?.current_products_assessment || [];
  assessment.forEach((item, index) => {
    const id = item?.suggested_replacement_product_id;
    const name = item?.suggested_replacement;
    if (item?.verdict === 'replace') {
      if (!id || !name) errors.push(`product audit item ${index + 1} replacement requires a known catalogue ID and name`);
      else checkProduct(id, name, `product audit item ${index + 1}`);
    } else if (id !== null || name !== null) errors.push(`product audit item ${index + 1} must have null replacement fields unless verdict=replace`);
  });

  if (output.srProducts) {
    checkProduct(output.srProducts.era_hero_product?.sr_product_id, output.srProducts.era_hero_product?.sr_product_name, 'SR hero');
    for (const period of ['am', 'pm']) {
      const generic = output.era?.routine?.[period] || [];
      const sr = output.srProducts[period] || [];
      const expected = generic.map(step => step.category_id);
      const actual = sr.map(step => step.category_id);
      // A present SR routine replaces the generic one in the app, so a partial category list would hide needed steps.
      if (expected.length !== actual.length || expected.some((category, index) => category !== actual[index])) {
        errors.push(`SR ${period.toUpperCase()} category/order coverage must match the generic routine`);
      }
      const seenCategories = new Set();
      const seenProducts = new Set();
      sr.forEach((step, index) => {
        const label = `SR ${period.toUpperCase()} step ${index + 1}`;
        if (step?.sr_product_id === '') errors.push(`${label} has an empty catalogue ID`);
        if (step?.step !== index + 1) errors.push(`${label} step number must match its routine position`);
        if (!ROUTINE_CATEGORY_IDS.includes(step?.category_id)) errors.push(`${label} has an unknown category_id`);
        if (seenCategories.has(step?.category_id)) errors.push(`${period.toUpperCase()} SR routine repeats category ${step?.category_id}`);
        seenCategories.add(step?.category_id);
        if (step?.category_id === 'protect' && (step.sr_product_id !== null || step.sr_product_name)) {
          errors.push(`${label} must have a null ID and empty name because no catalogue SPF value is verified`);
        }
        if (step?.sr_product_id) {
          checkProduct(step.sr_product_id, step.sr_product_name, label);
          const product = byId.get(String(step.sr_product_id));
          if (product && !routineProductCategoryCompatible(step, product)) {
            errors.push(`${label} product category is not compatible with ${step.category_id}`);
          }
          if (seenProducts.has(step.sr_product_id)) errors.push(`${period.toUpperCase()} SR routine repeats product ${step.sr_product_id}`);
          seenProducts.add(step.sr_product_id);
          if (step.no_match_note) errors.push(`${label} has no_match_note despite having a matched product`);
          if (step.category_id === 'protect') errors.push(`${label} must be unmatched because no catalogue SPF value is verified`);
        } else {
          if (step?.sr_product_name) errors.push(`${label} has a product name without a catalogue id`);
          if (!String(step?.no_match_note || '').trim()) errors.push(`${label} needs a useful no_match_note when unmatched`);
          if (step?.category_id === 'cleanse' || step?.category_id === 'protect') {
            if (step?.sr_product_name || step?.sr_product_id) errors.push(`${label} unmatched cleanse/protect step must not name a product`);
          }
        }
      });
    }
  }

  if (output.shelfAnalysis) {
    const hasShelfPhoto = (caseData.images || []).some(image => String(image?.angle || '').toLowerCase().startsWith('shelf'));
    if (!hasShelfPhoto) errors.push('shelfAnalysis must be null when no shelf photos were provided');
    for (const [index, product] of (output.shelfAnalysis.identified_products || []).entries())
      checkProduct(product?.sr_substitute_product_id, product?.sr_substitute_name, `shelf substitute ${index + 1}`);
    checkProduct(output.shelfAnalysis.transition_plan?.first_sr_purchase_product_id, output.shelfAnalysis.transition_plan?.first_sr_purchase, 'shelf transition purchase');
  }
  return { errors };
}

module.exports = {
  ERA_IDS, ROUTINE_CATEGORY_IDS, outputSchema, buildMessages, validateOutput,
  sanitizeQuiz, eligibleProducts, hasCompleteSafetyContext, isPregnancyCaution, allergiesFromQuiz, activeIrritantClasses,
  productSafetyIssue, eligibilityLimitations,
};
