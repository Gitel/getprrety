import { ERAS, fallbackEra } from '../constants';
import { downscaleDataUrl } from './downscaleImage';

const RAILWAY_URL = 'https://getpretty-api-production.up.railway.app';

// A stalled connection must never trap the user on the loading screen. LoadingScreen
// deliberately waits on this request before revealing the Era, so without a ceiling a
// hung socket never reaches the fallback. Abort after this long and let the caller's
// catch build the offline fallback.
const ANALYZE_TIMEOUT_MS = 45000;

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

// Map app quiz answer fields → Railway API schema.
// `today` is injectable only so tests can pin the age calculation.
export function buildQuizPayload(answers, today = new Date()) {
  const age = ageFromBirthday(answers.birthday, today);
  // Breastfeeding counts like pregnancy / trying to conceive (owner decision), so Gemini
  // applies the same cautious ingredient rules (e.g. retinoids).
  const pregnancyCaution = answers.hormones?.pregnant === 'yes'
    || answers.hormones?.trying_to_conceive === 'yes'
    || answers.hormones?.breastfeeding === 'yes';
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
    pregnant_or_ttc:      answers.gender === 'she' && pregnancyCaution ? 'yes' : 'no',
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

// Map Railway response → existing app analysis format.
// Throws when the response is not a usable analysis; LoadingScreen then shows the
// generic fallback, marked as such, with the error as the reason.
export function mapToAppFormat(railwayResponse, answers) {
  const gemini      = railwayResponse?.era || {};
  const eraData     = gemini.era || {};
  const skinData    = gemini.skin_analysis || {};
  const routineData = gemini.routine || {};
  const auditData   = gemini.product_audit || {};

  // A 200 response is not proof of an analysis. Before this check, an unexpected shape
  // (Railway schema change, an error body sent with 200) mapped silently to an empty
  // routine ("0/0 steps") and a blank analysis - no fallback, no marker, no log.
  // A routine counts if either the generic steps or the product routine has any.
  const srProducts = railwayResponse?.srProducts;
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
    add.push({ product: auditData.most_urgent_gap, reason: 'Most urgent addition for your era', priority: 'essential' });
  }
  assessment.filter(p => p.verdict === 'missing').forEach(p => {
    if (p.product_type !== auditData.most_urgent_gap) {
      add.push({ product: p.product_type, reason: p.note, priority: 'recommended' });
    }
  });

  const routine = {
    am: (routineData.am || []).map(s => ({ name: s.category, description: s.instruction })),
    pm: (routineData.pm || []).map(s => ({ name: s.category, description: s.instruction })),
  };

  return {
    eraId,
    era,
    skinAnalysis: skinData.summary || '',
    keyInsights,
    productAudit: { keep, remove, replace, add },
    routine,
    affirmation: eraData.affirmation || era.affirmation,
    checkInPrompts: gemini.check_in_prompts || [],
    safetyFlags:    gemini.safety_flags || [],
    eventPrep:      gemini.event_prep || null,
    // Marks this as a real Gemini result. LoadingScreen stamps 'fallback' instead when
    // the call fails, so the app, /admin and the clinic email can tell the two apart.
    source:         'gemini',
    // Product-matched AM/PM routine and shelf-photo audit. Kept ON the analysis (not in
    // separate state) so they are saved and restored with it; before, they lived only in
    // React state and disappeared on reload. Shapes are owned by the Railway service.
    srProducts:     railwayResponse.srProducts || null,
    shelfAnalysis:  railwayResponse.shelfAnalysis || null,
  };
}

// Resolve a photo reference to raw base64 (no data: prefix). Capacitor Camera
// returns data URLs, which work on both native shells and the browser.
// The photo is shrunk first (max 1600 px, JPEG 85%) - only this Gemini copy.
async function toBase64(ref) {
  if (!ref || typeof ref !== 'string') return null;
  if (!ref.startsWith('data:')) return null;
  const small = await downscaleDataUrl(ref);
  return small.split(',')[1] || null;
}

// One photo at a time, on purpose: each decoded full-size photo is ~50 MB of pixels,
// and decoding up to 14 at once (Promise.all) can run a phone out of memory.
async function toBase64List(refs) {
  const out = [];
  for (const ref of refs) {
    const base64 = await toBase64(ref);
    if (base64) out.push(base64);
  }
  return out;
}

export async function analyzeWithRailway(answers) {
  const quizPayload = buildQuizPayload(answers);

  // Convert photos to base64 (quiz may store them as data: URLs or native file:// URIs)
  const skinPhotosBase64  = await toBase64List(['front', 'left', 'right', 'closeup', 'neck'].map(k => answers[k]));
  const shelfPhotosBase64 = await toBase64List(answers.shelf_photos || []);

  console.log(`analyzeWithRailway: sending ${skinPhotosBase64.length} skin photo(s), ${shelfPhotosBase64.length} shelf photo(s)`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

  let res;
  let data;
  try {
    res = await fetch(`${RAILWAY_URL}/analyze-skin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizAnswers: quizPayload,
        userId: answers.userId || null,
        skinPhotosBase64,
        shelfPhotosBase64,
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Railway API ${res.status}`);

    data = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Railway API timed out after ${ANALYZE_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // One object carries everything (srProducts / shelfAnalysis included - see mapToAppFormat).
  return mapToAppFormat(data, answers);
}
