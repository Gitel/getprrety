import { ERAS, fallbackEra } from '../constants';
import { downscaleDataUrl } from './downscaleImage';
import { api } from './api';
import i18n from './i18n';

const ANALYZE_TIMEOUT_MS = 60000;
const MAX_ANALYSIS_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const SKIN_PHOTO_ANGLES = ['front', 'left', 'right', 'closeup', 'neck'];

// Map new expanded skin_goals values down to the legacy 6-bucket concern
// taxonomy the existing Skin Era decision tree reads. Goals with no legacy
// equivalent are simply omitted from `concerns` but still sent in full
// under `skin_goals`.
const GOAL_TO_LEGACY_CONCERN = {
  acne:          'breakouts',
  sensitive:     'sensitive',
  dryness:       'dryness',
  fine_lines:    'fine_lines',
  wrinkles:      'fine_lines',
  pigmentation:  'dark_spots',
  melasma:       'dark_spots',
  large_pores:   'pores',
};

const SMOKE_TO_LEGACY = {
  daily:        'yes',
  occasionally: 'sometimes',
  never:        'no',
  // 'yes' key removed — option no longer exists in the quiz (smoke tiers cleaned up in v3)
};

// Quiz skin-tone values are Roman numerals (SKIN_TONES in constants.js); the Railway
// contract's `fitzpatrick` is a number 1-6. The original mapping did Number('III'),
// which is NaN, so Gemini always received the default 2 - and after the July quiz
// rebuild it received nothing at all.
const FITZPATRICK = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };

// Whole years from the quiz birthday ('DD/MM/YYYY', from DrumDatePicker). null when the
// value is missing or malformed.
export function ageFromBirthday(birthday, today = new Date()) {
  const match = typeof birthday === 'string' && birthday.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  let age = today.getFullYear() - year;
  // Birthday not reached yet this year -> one year younger.
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// 10-year buckets in the style of the original contract's '25-34' (owner decision).
// The quiz allows ages from 10, so younger users get 'under-18' rather than being
// reported as adults. The exact values Railway expects are unconfirmed (source missing).
export function ageRange(age) {
  if (age == null) return null;
  if (age < 18) return 'under-18';
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  if (age < 65) return '55-64';
  return '65+';
}

// Whether Gemini must apply its cautious ingredient rules (e.g. no retinoids). Breastfeeding
// counts like pregnancy / trying to conceive (owner decision); women only, as before.
// Shared by the Era analysis (below) and the score-reading answers (src/lib/skinScan.js).
export function hasPregnancyCaution(answers) {
  const caution = answers?.hormones?.pregnant === 'yes'
    || answers?.hormones?.trying_to_conceive === 'yes'
    || answers?.hormones?.breastfeeding === 'yes';
  return answers?.gender === 'she' && caution;
}

// Map app quiz answer fields → Railway API schema.
// `today` is injectable only so tests can pin the age calculation.
export function buildQuizPayload(answers, today = new Date()) {
  const age = ageFromBirthday(answers.birthday, today);
  const productMap = {
    cleanser:    'cleanser',
    toner:       'toner',
    serum:       'serum',
    moisturizer: 'moisturizer',
    eye_cream:   'eye_cream',
    sunscreen:   'sunscreen',
    retinol:     'retinol',
    exfoliant:   'exfoliant',
    face_oil:    'face_oil',
    mask:        'mask',
    none:        'not_much',
  };

  const legacyConcerns = (answers.skin_goals || [])
    .map(g => GOAL_TO_LEGACY_CONCERN[g])
    .filter(Boolean);

  const products  = (answers.routine_products || []).map(p => productMap[p] || p);
  const hasPhotos = ['front', 'left', 'right', 'closeup', 'neck'].some(k => answers[k]);

  return {
    // ── existing fields (unchanged shape, feeds current decision tree) ──
    identity:             answers.gender || 'she',
    concerns:             legacyConcerns,
    current_products:     products,
    smokes:               SMOKE_TO_LEGACY[answers.smoke] || 'no',
    has_diabetes:         (answers.health_conditions || []).includes('diabetes') ? 'yes' : 'no',
    allergies:            answers.allergies || ['none'],
    pregnant_or_ttc:      hasPregnancyCaution(answers) ? 'yes' : 'no',
    name:                 answers.name || null,
    interests:            answers.interests || [],
    // The quiz's "No special event" option is 'no_event'; the contract's no-event value
    // is 'none', so Gemini must not plan for an event called "no_event".
    event_type:           answers.event && answers.event !== 'no_event' ? answers.event : 'none',
    event_date:           answers.event_date || null,
    skin_photos_uploaded:  hasPhotos,
    shelf_photos_uploaded: (answers.shelf_photos || []).length > 0,
    // Restored: part of the original contract, dropped by the July quiz rebuild although
    // birthday and skin tone are still asked. null when not answered (no invented default).
    fitzpatrick:           FITZPATRICK[answers.tone] ?? null,
    age_range:             ageRange(age),
    age,                   // raw years, alongside the bucket (owner decision)

    // ── new fields — sent through, not yet consumed by any decision logic ──
    city:                  answers.city || null,
    country:               answers.country || null,
    work_environment:      answers.work_environment || null,
    post_cleanse_feel:     answers.post_cleanse_feel || null,
    irritants:             answers.irritants || [],
    skin_goals:            answers.skin_goals || [],
    diagnosed_conditions:  answers.diagnosed_conditions || [],
    health_conditions:     answers.health_conditions || [],
    sleep:                 answers.sleep || null,
    stress:                answers.stress || null,
    water_intake:          answers.water_intake || null,
    alcohol:               answers.alcohol || null,
    exercise:              answers.exercise || null,
    top_concern:           answers.top_concern || null,
    irritants_other:            answers.irritants_other || null,
    diagnosed_conditions_other: answers.diagnosed_conditions_other || null,
    allergies_other:            answers.allergies_other || null,

    // ── intentionally NOT included: hormones (held per scope decision), except that
    //    pregnant / trying to conceive / breastfeeding feed pregnant_or_ttc above ──
  };
}

// Map backend response → existing app analysis format.
// Throws when the response is not a usable analysis; LoadingScreen then shows the
// generic fallback, marked as such, with the error as the reason.
export function mapToAppFormat(analysisResponse, answers) {
  const eraResponse = analysisResponse?.era || {};
  const eraData     = eraResponse.era || {};
  const skinData    = eraResponse.skin_analysis || {};
  const routineData = eraResponse.routine || {};
  const auditData   = eraResponse.product_audit || {};

  // A 200 response is not proof of an analysis. Before this check, an unexpected shape
  // (provider schema change, an error body sent with 200) mapped silently to an empty
  // routine ("0/0 steps") and a blank analysis - no fallback, no marker, no log.
  // A routine counts if either the generic steps or the product routine has any.
  const srProducts = analysisResponse?.srProducts;
  const hasRoutine = [routineData.am, routineData.pm, srProducts?.am, srProducts?.pm]
    .some(steps => Array.isArray(steps) && steps.length > 0);
  if (!eraData.id) throw new Error('Invalid analysis response: no era id');
  if (!hasRoutine) throw new Error('Invalid analysis response: no routine steps');

  const eraId = eraData.id;
  const era   = ERAS[eraId] || fallbackEra(answers);

  const keyInsights = (skinData.key_insights || []).map(i =>
    i.title ? `${i.title}: ${i.body || ''}` : String(i)
  );

  // Map current_products_assessment → existing productAudit shape.
  // verdict: keep | replace | remove | missing. A `replace` verdict must land in the
  // `replace` bucket (from → to), NOT `remove` — the old mapping funneled every
  // replace into remove and always returned replace: [], so the UI told users to
  // discard products instead of showing the swap.
  const assessment = auditData.current_products_assessment || [];
  const keep    = assessment.filter(p => p.verdict === 'keep')
                            .map(p => ({ product: p.product_type, reason: p.note }));
  const remove  = assessment.filter(p => p.verdict === 'remove')
                            .map(p => ({ product: p.product_type, reason: p.note }));
  const replace = assessment.filter(p => p.verdict === 'replace')
                            .map(p => ({
                              from: p.product_type,
                              to: p.suggested_replacement || p.replacement || p.replace_with || null,
                              reason: p.note,
                            }));
  const add = [];
  if (auditData.most_urgent_gap) {
    add.push({ product: auditData.most_urgent_gap, reason: i18n.t('content:railway.urgentAddition'), priority: 'essential' });
  }
  assessment.filter(p => p.verdict === 'missing').forEach(p => {
    if (p.product_type !== auditData.most_urgent_gap) {
      add.push({ product: p.product_type, reason: p.note, priority: 'recommended' });
    }
  });

  const routine = {
    am: (routineData.am || []).map(s => ({ category_id: s.category_id, name: s.category, description: s.instruction })),
    pm: (routineData.pm || []).map(s => ({ category_id: s.category_id, name: s.category, description: s.instruction })),
  };

  return {
    eraId,
    era,
    skinAnalysis: skinData.summary || '',
    keyInsights,
    productAudit: { keep, remove, replace, add },
    routine,
    affirmation: eraData.affirmation || era.affirmation,
    checkInPrompts: eraResponse.check_in_prompts || [],
    safetyFlags:    eraResponse.safety_flags || [],
    eventPrep:      eraResponse.event_prep || null,
    // Preserve the server provider marker through display and persistence.
    source:         analysisResponse?.source === 'bedrock' ? 'bedrock' : 'gemini',
    // Product-matched AM/PM routine and shelf-photo audit. Kept ON the analysis (not in
    // separate state) so they are saved and restored with it; before, they lived only in
    // React state and disappeared on reload. The backend validates these contract shapes.
    srProducts:     analysisResponse.srProducts || null,
    shelfAnalysis:  analysisResponse.shelfAnalysis || null,
  };
}

// Return one labelled, bounded photo. Rejecting an oversized original handles canvas
// downscaling failures without sending a request beyond the server's parser limits.
async function toAnalysisImage(ref, angle) {
  if (!ref || typeof ref !== 'string') return null;
  if (!ref.startsWith('data:')) return null;
  const small = await downscaleDataUrl(ref);
  const match = small.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match) throw new Error('Unsupported analysis image format');
  const [, mediaType, base64] = match;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor(base64.length * 3 / 4) - padding;
  if (bytes > MAX_IMAGE_BYTES) throw new Error('Analysis image is too large after resizing');
  return { angle, mediaType: mediaType.toLowerCase(), base64, bytes };
}

// Decode photos in order so mobile browsers do not allocate several large canvases at once.
async function toAnalysisImages(refs) {
  const out = [];
  let totalBytes = 0;
  for (const [ref, angle] of refs) {
    const image = await toAnalysisImage(ref, angle);
    if (!image) continue;
    totalBytes += image.bytes;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new Error('Analysis photos exceed the request size limit');
    out.push({ angle: image.angle, mediaType: image.mediaType, base64: image.base64 });
  }
  return out;
}

// Direct identifiers and location stay out of the paid skin-analysis request.
export function minimizeQuizAnswers(answers = {}) {
  const { name, city, country, ...payload } = buildQuizPayload(answers);
  // Keep buildQuizPayload's compatibility defaults for its other callers, but do not
  // turn skipped safety questions into negative answers on paid Bedrock requests.
  for (const key of ['allergies', 'allergies_other', 'irritants', 'irritants_other']) {
    if (Object.hasOwn(answers, key)) payload[key] = answers[key];
    else delete payload[key];
  }

  // A positive answer is always retained; a negative needs explicit legacy input or
  // complete applicability answers so a skipped question cannot clear a restriction.
  const hormones = answers.hormones || {};
  const allHormonesAnswered = ['pregnant', 'trying_to_conceive', 'breastfeeding']
    .every(key => hormones[key] === 'yes' || hormones[key] === 'no');
  if (hasPregnancyCaution(answers) || answers.pregnancy_caution === true
    || answers.pregnant_or_ttc === 'yes' || answers.pregnant_or_ttc === true) {
    payload.pregnant_or_ttc = 'yes';
  } else if (answers.pregnant_or_ttc === 'no' || answers.pregnant_or_ttc === false || answers.pregnancy_caution === false
    || answers.gender === 'he' || (answers.gender === 'she' && allHormonesAnswered)) {
    payload.pregnant_or_ttc = 'no';
  } else {
    delete payload.pregnant_or_ttc;
  }
  return payload;
}

// Market recommendations need only safety facts, including after a saved analysis is reopened.
export function buildProductSafetyContext(answers = {}) {
  const context = {};
  // Keep absent legacy answers absent so the server can fail closed instead of
  // mistaking old snapshots for an explicit "no allergies / no pregnancy" response.
  if (Object.hasOwn(answers, 'pregnant_or_ttc')) context.pregnant_or_ttc = answers.pregnant_or_ttc;
  else if (Object.hasOwn(answers, 'pregnancy_caution')) context.pregnancy_caution = answers.pregnancy_caution;
  else if (answers.gender === 'he' && Object.hasOwn(answers, 'allergies') && Object.hasOwn(answers, 'irritants')) context.pregnant_or_ttc = 'no';
  else if (answers.gender === 'she' && ['pregnant', 'breastfeeding', 'trying_to_conceive'].every(key => answers.hormones?.[key] === 'yes' || answers.hormones?.[key] === 'no')) {
    context.pregnant_or_ttc = hasPregnancyCaution(answers) ? 'yes' : 'no';
  }
  for (const key of [
    'allergies', 'allergies_other', 'irritants', 'irritants_other',
    'health_conditions', 'diagnosed_conditions', 'safetyContextVersion',
  ]) {
    if (Object.hasOwn(answers, key)) context[key] = answers[key];
  }
  for (const key of ['ahas_bhas', 'has_bhas', 'retinoids', 'sulfates']) {
    if (typeof answers[key] === 'boolean' || typeof answers[key] === 'string') context[key] = answers[key];
  }
  return context;
}

export async function analyzeSkin(answers = {}, language = i18n.language) {
  const photoRefs = [
    ...SKIN_PHOTO_ANGLES.map(angle => [answers[angle], angle]),
    ...(answers.shelf_photos || []).map(ref => [ref, 'shelf']),
  ].filter(([ref]) => typeof ref === 'string' && ref.startsWith('data:'));
  if (photoRefs.length > MAX_ANALYSIS_IMAGES) throw new Error('Too many analysis photos');
  const images = await toAnalysisImages(photoRefs);
  const data = await api.post('/api/ai/analyze-skin', {
    quizAnswers: minimizeQuizAnswers(answers),
    language: String(language || 'en').toLowerCase().startsWith('he') ? 'he' : 'en',
    images,
  }, { timeoutMs: ANALYZE_TIMEOUT_MS });
  if (data?.source !== 'bedrock') throw new Error('Invalid analysis response: missing Bedrock source');
  return mapToAppFormat(data, answers);
}
