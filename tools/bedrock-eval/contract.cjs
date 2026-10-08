const ERA_IDS = [
  'barrier_healing',
  'acne_reset',
  'burnout_recovery',
  'glow_building',
  'repair_restore',
];

const categories = ['cleansers_peelings', 'face_serums', 'eye', 'face_creams', 'masks'];
const shelfStatuses = ['compatible', 'borderline', 'conflicting', 'unknown'];

// Strict response schema mirrors the Railway payload consumed by mapToAppFormat,
// while attaching catalogue IDs so the evaluator can reject fabricated products.
const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['era', 'srProducts', 'shelfAnalysis'],
  properties: {
    era: {
      type: 'object',
      additionalProperties: false,
      required: ['era', 'skin_analysis', 'routine', 'product_audit', 'check_in_prompts', 'safety_flags', 'event_prep'],
      properties: {
        era: {
          type: 'object', additionalProperties: false, required: ['id', 'affirmation'],
          properties: { id: { type: 'string', enum: ERA_IDS }, affirmation: { type: 'string' } },
        },
        skin_analysis: {
          type: 'object', additionalProperties: false, required: ['summary', 'key_insights'],
          properties: {
            summary: { type: 'string' },
            key_insights: {
              type: 'array', maxItems: 8, items: {
                type: 'object', additionalProperties: false, required: ['title', 'body'],
                properties: { title: { type: 'string' }, body: { type: 'string' } },
              },
            },
          },
        },
        routine: {
          type: 'object', additionalProperties: false, required: ['am', 'pm'],
          properties: {
            am: { type: 'array', minItems: 1, maxItems: 8, items: { $ref: '#/$defs/routineStep' } },
            pm: { type: 'array', minItems: 1, maxItems: 8, items: { $ref: '#/$defs/routineStep' } },
          },
        },
        product_audit: {
          type: 'object', additionalProperties: false, required: ['current_products_assessment', 'most_urgent_gap'],
          properties: {
            current_products_assessment: {
              type: 'array', maxItems: 20, items: {
                type: 'object', additionalProperties: false,
                required: ['product_type', 'verdict', 'note', 'suggested_replacement', 'suggested_replacement_product_id'],
                properties: {
                  product_type: { type: 'string' },
                  verdict: { type: 'string', enum: ['keep', 'remove', 'replace', 'missing'] },
                  note: { type: 'string' },
                  suggested_replacement: { type: ['string', 'null'] },
                  suggested_replacement_product_id: { type: ['string', 'null'] },
                },
              },
            },
            most_urgent_gap: { type: ['string', 'null'] },
          },
        },
        check_in_prompts: { type: 'array', maxItems: 5, items: { type: 'string' } },
        safety_flags: { type: 'array', maxItems: 12, items: { type: 'string' } },
        event_prep: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object', additionalProperties: false, required: ['summary', 'steps'],
              properties: {
                summary: { type: 'string' },
                steps: { type: 'array', maxItems: 8, items: {
                  type: 'object', additionalProperties: false, required: ['when', 'action'],
                  properties: { when: { type: 'string' }, action: { type: 'string' } },
                } },
              },
            },
          ],
        },
      },
    },
    srProducts: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false, required: ['bundle_note', 'era_hero_product', 'am', 'pm'],
          properties: {
            bundle_note: { type: 'string' },
            era_hero_product: {
              type: 'object', additionalProperties: false,
              required: ['sr_product_id', 'sr_product_name', 'hero_reason'],
              properties: {
                sr_product_id: { type: ['string', 'null'] },
                sr_product_name: { type: 'string' },
                hero_reason: { type: 'string' },
              },
            },
            am: { type: 'array', maxItems: 15, items: { $ref: '#/$defs/srStep' } },
            pm: { type: 'array', maxItems: 15, items: { $ref: '#/$defs/srStep' } },
          },
        },
      ],
    },
    shelfAnalysis: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false,
          required: ['identified_products', 'shelf_summary', 'transition_plan'],
          properties: {
            identified_products: { type: 'array', maxItems: 30, items: {
              type: 'object', additionalProperties: false,
              required: ['status', 'brand', 'product_name', 'category', 'status_reason', 'use_instruction', 'sr_substitute_name', 'sr_substitute_product_id'],
              properties: {
                status: { type: 'string', enum: shelfStatuses },
                brand: { type: 'string' },
                product_name: { type: 'string' },
                category: { type: 'string', enum: [...categories, 'unknown'] },
                status_reason: { type: 'string' },
                use_instruction: { type: 'string' },
                sr_substitute_name: { type: 'string' },
                sr_substitute_product_id: { type: ['string', 'null'] },
              },
            } },
            shelf_summary: {
              type: 'object', additionalProperties: false, required: ['overall_note'],
              properties: { overall_note: { type: 'string' } },
            },
            transition_plan: {
              type: 'object', additionalProperties: false,
              required: ['first_sr_purchase', 'first_sr_purchase_product_id'],
              properties: {
                first_sr_purchase: { type: 'string' },
                first_sr_purchase_product_id: { type: ['string', 'null'] },
              },
            },
          },
        },
      ],
    },
  },
  $defs: {
    routineStep: {
      type: 'object', additionalProperties: false, required: ['category', 'instruction'],
      properties: { category: { type: 'string' }, instruction: { type: 'string' } },
    },
    srStep: {
      type: 'object', additionalProperties: false,
      required: ['step', 'routine_category', 'sr_product_id', 'sr_product_name', 'key_actives_matched', 'use_instruction', 'match_reason', 'no_match_note'],
      properties: {
        step: { type: 'integer', minimum: 1 },
        routine_category: { type: 'string' },
        sr_product_id: { type: 'string' },
        sr_product_name: { type: 'string' },
        key_actives_matched: { type: 'array', maxItems: 10, items: { type: 'string' } },
        use_instruction: { type: 'string' },
        match_reason: { type: 'string' },
        no_match_note: { type: 'string' },
      },
    },
  },
};

const QUIZ_KEYS = [
  // Bounded assessment fields include legacy identity labels; contact/location and raw birthday stay excluded.
  'age', 'age_range', 'gender', 'identity', 'tone', 'fitzpatrick', 'concerns', 'skin_goals', 'top_concern',
  'post_cleanse_feel', 'irritants', 'diagnosed_conditions', 'health_conditions',
  'diabetes', 'has_diabetes', 'diabetes_caution', 'pregnant', 'pregnant_or_ttc', 'pregnancy_caution',
  'allergies', 'allergies_other', 'irritants_other', 'diagnosed_conditions_other',
  'routine_products', 'current_products', 'smoke', 'smokes', 'work_environment', 'sleep', 'stress',
  'water_intake', 'alcohol', 'exercise', 'interests', 'event', 'event_type', 'event_date',
];

function isPregnancyCaution(quiz = {}) {
  // Only an explicit positive answer activates the catalogue restriction; absence stays absent in model input.
  return quiz.pregnancy_caution === true || quiz.pregnant_or_ttc === 'yes' || quiz.pregnant_or_ttc === true
    || quiz.pregnant === 'yes' || quiz.pregnant === true
    || quiz.hormones?.pregnant === 'yes'
    || quiz.hormones?.trying_to_conceive === 'yes'
    || quiz.hormones?.breastfeeding === 'yes';
}

function eligibleProducts(catalogue = [], quiz = {}) {
  return catalogue.filter(product => product && String(product._id || '').trim()
    && product.use === 'home' && product.archived !== true
    && (!isPregnancyCaution(quiz) || product.pregnancy === 'safe'));
}

function compactQuiz(quiz = {}) {
  const safe = {};
  for (const key of QUIZ_KEYS) {
    const value = quiz[key];
    if (value !== undefined && value !== null && value !== '') safe[key] = value;
  }
  // Never send names, precise location, contact details, photo data or raw birthday.
  return safe;
}

function buildMessages({ quiz = {}, language = 'en', images = [], catalogue = [] } = {}) {
  const lang = String(language).toLowerCase().startsWith('he') ? 'he' : 'en';
  const products = eligibleProducts(catalogue, quiz).map(product => ({
    id: String(product._id || ''),
    name: product.name || '',
    category: product.category || 'unknown',
    pregnancy: product.pregnancy || 'not_stated',
    keyActives: Array.isArray(product.keyActives) ? product.keyActives : [],
    strengths: Array.isArray(product.strengths) ? product.strengths : [],
    suitableFor: Array.isArray(product.suitableFor) ? product.suitableFor : [],
    ingredients: typeof product.ingredients === 'string' ? product.ingredients.slice(0, 5000) : '',
  }));
  const photoParts = [];
  for (const image of images) {
    if (!image?.base64 || !image?.mediaType) continue;
    photoParts.push({ type: 'text', text: `Photo angle: ${image.angle || 'unspecified'}.` });
    photoParts.push({
      type: 'image_url',
      image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
    });
  }
  const noPhotos = photoParts.length === 0;
  const request = {
    language: lang === 'he' ? 'Hebrew' : 'English',
    quiz: compactQuiz(quiz),
    image_context: noPhotos
      ? 'No images were provided. Do not make visual observations or identify shelf products.'
      : 'Use only visible evidence from each labelled image. State uncertainty; never infer a diagnosis from a photo.',
    eligible_catalogue: products,
  };
  const content = [
    { type: 'text', text: `Evaluation input JSON:\n${JSON.stringify(request)}` },
    ...photoParts,
  ];
  return {
    system: require('node:fs').readFileSync(require('node:path').join(__dirname, 'prompt.md'), 'utf8'),
    messages: [{ role: 'user', content }],
  };
}

function collectText(output) {
  const root = output?.era || {};
  const analysis = root.skin_analysis || {};
  const audit = root.product_audit || {};
  const strings = [analysis.summary, root.era?.affirmation, root.check_in_prompts, root.safety_flags,
    root.product_audit?.most_urgent_gap];
  for (const insight of analysis.key_insights || []) strings.push(insight?.title, insight?.body);
  for (const item of audit.current_products_assessment || []) strings.push(item?.product_type, item?.note);
  for (const step of [...(root.routine?.am || []), ...(root.routine?.pm || [])]) strings.push(step?.category, step?.instruction);
  strings.push(root.event_prep?.summary);
  for (const step of root.event_prep?.steps || []) strings.push(step?.when, step?.action);
  if (output?.srProducts) {
    strings.push(output.srProducts.bundle_note, output.srProducts.era_hero_product?.hero_reason);
    for (const step of [...(output.srProducts.am || []), ...(output.srProducts.pm || [])]) {
      strings.push(step?.routine_category, step?.use_instruction, step?.match_reason, step?.no_match_note);
    }
  }
  if (output?.shelfAnalysis) {
    strings.push(output.shelfAnalysis.shelf_summary?.overall_note);
    for (const product of output.shelfAnalysis.identified_products || []) {
      strings.push(product?.status_reason, product?.use_instruction);
    }
  }
  return strings.flat(Infinity).filter(value => typeof value === 'string').join(' ');
}

function textHasRequestedLanguage(output, language) {
  const text = collectText(output);
  const letters = text.match(/[A-Za-z\u0590-\u05ff]/g) || [];
  if (!letters.length) return false;
  const target = language === 'he'
    ? (text.match(/[\u0590-\u05ff]/g) || []).length
    : (text.match(/[A-Za-z]/g) || []).length;
  // Allow catalogue names and skincare terms in English inside a Hebrew analysis.
  return target / letters.length >= (language === 'he' ? 0.35 : 0.65);
}

function allergiesFromQuiz(quiz = {}) {
  const raw = quiz.allergies;
  const list = Array.isArray(raw) ? [...raw, quiz.allergies_other] : [raw, quiz.allergies_other];
  return list.filter(value => value !== undefined && value !== null)
    .map(value => String(value).trim().toLowerCase())
    .filter(value => value && !['none', 'no', 'no allergies'].includes(value));
}

function validateOutput(output, caseData = {}, catalogue = []) {
  const errors = [];
  const quiz = caseData.quiz || caseData;
  const language = String(caseData.language || 'en').toLowerCase().startsWith('he') ? 'he' : 'en';
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { errors: ['output must be a JSON object'] };
  if (!ERA_IDS.includes(output.era?.era?.id)) errors.push('era.era.id must be a known app Era id');
  if (!textHasRequestedLanguage(output, language)) errors.push(`generated prose does not match requested language: ${language}`);
  if (typeof output.era?.skin_analysis?.summary !== 'string' || !output.era.skin_analysis.summary.trim()) {
    errors.push('skin analysis summary must not be empty');
  }
  for (const period of ['am', 'pm']) {
    const steps = output.era?.routine?.[period] || [];
    steps.forEach((step, index) => {
      if (typeof step?.instruction !== 'string' || !step.instruction.trim()) {
        errors.push(`${period.toUpperCase()} routine step ${index + 1} instruction must not be empty`);
      }
    });
  }

  const eligible = eligibleProducts(catalogue, quiz);
  const byId = new Map(eligible.map(product => [String(product._id), product]));
  const allergies = allergiesFromQuiz(quiz);
  const checkProduct = (id, name, label) => {
    if (!id) {
      if (name) errors.push(`${label} has a product name without a catalogue id`);
      return;
    }
    const product = byId.get(String(id));
    if (!product) {
      errors.push(`${label} references a product outside the eligible catalogue`);
      return;
    }
    if (String(name || '').trim().toLowerCase() !== String(product.name || '').trim().toLowerCase()) {
      errors.push(`${label} name does not match its catalogue id`);
    }
    const ingredients = String(product.ingredients || '').toLowerCase();
    if (allergies.length && !ingredients.trim()) errors.push(`${label} cannot be checked against the allergy answers`);
    for (const allergy of allergies) {
      if (allergy.length >= 3 && ingredients.includes(allergy)) errors.push(`${label} contains a listed allergy: ${allergy}`);
    }
  };

  const assessment = output.era?.product_audit?.current_products_assessment || [];
  assessment.forEach((item, index) => {
    const id = item?.suggested_replacement_product_id;
    const name = item?.suggested_replacement;
    if (item?.verdict === 'replace') checkProduct(id, name, `product audit item ${index + 1}`);
    else if (id || name) errors.push(`product audit item ${index + 1} has replacement data without verdict=replace`);
  });

  if (output.srProducts) {
    checkProduct(output.srProducts.era_hero_product?.sr_product_id,
      output.srProducts.era_hero_product?.sr_product_name, 'SR hero');
    for (const [period, steps] of [['AM', output.srProducts.am], ['PM', output.srProducts.pm]]) {
      (steps || []).forEach((step, index) => {
        if (step?.sr_product_id) checkProduct(step.sr_product_id, step.sr_product_name, `SR ${period} step ${index + 1}`);
        else if (step?.sr_product_name) errors.push(`SR ${period} step ${index + 1} has a product name without a catalogue id`);
      });
    }
  }

  if (output.shelfAnalysis) {
    const hasShelfPhoto = (caseData.images || []).some(image => String(image?.angle || '').toLowerCase().startsWith('shelf'));
    if (!hasShelfPhoto) errors.push('shelfAnalysis must be null when no shelf photos were provided');
    for (const [index, product] of (output.shelfAnalysis.identified_products || []).entries()) {
      checkProduct(product?.sr_substitute_product_id, product?.sr_substitute_name, `shelf substitute ${index + 1}`);
    }
    checkProduct(output.shelfAnalysis.transition_plan?.first_sr_purchase_product_id,
      output.shelfAnalysis.transition_plan?.first_sr_purchase, 'shelf transition purchase');
  }
  return { errors };
}

module.exports = { ERA_IDS, outputSchema, buildMessages, validateOutput, eligibleProducts, isPregnancyCaution };
