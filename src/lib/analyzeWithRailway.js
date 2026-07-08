import { ERAS, fallbackEra } from '../constants';

const RAILWAY_URL = 'https://getpretty-api-production.up.railway.app';

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
  yes:          'yes',
  daily:        'yes',
  occasionally: 'sometimes',
  never:        'no',
};

// Map app quiz answer fields → Railway API schema
function buildQuizPayload(answers) {
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
    pregnant_or_ttc:      answers.gender === 'she'
                            ? ((answers.hormones?.pregnant === 'yes' || answers.hormones?.trying_to_conceive === 'yes') ? 'yes' : 'no')
                            : 'no',
    name:                 answers.name || null,
    interests:            answers.interests || [],
    event_type:           answers.event || 'none',
    event_date:           answers.event_date || null,
    skin_photos_uploaded:  hasPhotos,
    shelf_photos_uploaded: (answers.shelf_photos || []).length > 0,

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

    // ── intentionally NOT included: hormones (held per scope decision) ──
  };
}

// Map Railway response → existing app analysis format
function mapToAppFormat(railwayResponse, answers) {
  const gemini      = railwayResponse.era || {};
  const eraData     = gemini.era || {};
  const skinData    = gemini.skin_analysis || {};
  const routineData = gemini.routine || {};
  const auditData   = gemini.product_audit || {};

  const eraId = eraData.id || 'barrier_healing';
  const era   = ERAS[eraId] || fallbackEra(answers);

  const keyInsights = (skinData.key_insights || []).map(i =>
    i.title ? `${i.title}: ${i.body || ''}` : String(i)
  );

  // Map current_products_assessment → existing productAudit shape
  const assessment = auditData.current_products_assessment || [];
  const keep    = assessment.filter(p => p.verdict === 'keep')
                            .map(p => ({ product: p.product_type, reason: p.note }));
  const remove  = assessment.filter(p => p.verdict === 'replace' || p.verdict === 'missing')
                            .filter(p => p.verdict === 'replace')
                            .map(p => ({ product: p.product_type, reason: p.note }));
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
    productAudit: { keep, remove, replace: [], add },
    routine,
    affirmation: eraData.affirmation || era.affirmation,
    checkInPrompts: gemini.check_in_prompts || [],
    safetyFlags:    gemini.safety_flags || [],
    eventPrep:      gemini.event_prep || null,
  };
}

// Resolve a photo reference to raw base64 (no data: prefix).
// Handles data: URLs (web + native base64 capture) and, as a safety net,
// file://content:// URIs (native) via expo-file-system.
async function toBase64(ref) {
  if (!ref || typeof ref !== 'string') return null;
  if (ref.startsWith('data:')) return ref.split(',')[1] || null;
  if (ref.startsWith('file://') || ref.startsWith('content://')) {
    try {
      const FileSystem = require('expo-file-system');
      return await FileSystem.readAsStringAsync(ref, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch (e) {
      console.warn('toBase64: could not read native file', e?.message);
      return null;
    }
  }
  return null;
}

export async function analyzeWithRailway(answers) {
  const quizPayload = buildQuizPayload(answers);

  // Convert photos to base64 (quiz may store them as data: URLs or native file:// URIs)
  const skinPhotosBase64 = (
    await Promise.all(['front', 'left', 'right', 'closeup', 'neck'].map(k => toBase64(answers[k])))
  ).filter(Boolean);

  const shelfPhotosBase64 = (
    await Promise.all((answers.shelf_photos || []).map(toBase64))
  ).filter(Boolean);

  console.log(`analyzeWithRailway: sending ${skinPhotosBase64.length} skin photo(s), ${shelfPhotosBase64.length} shelf photo(s)`);

  const res = await fetch(`${RAILWAY_URL}/analyze-skin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quizAnswers: quizPayload,
      userId: answers.userId || null,
      skinPhotosBase64,
      shelfPhotosBase64,
    }),
  });

  if (!res.ok) throw new Error(`Railway API ${res.status}`);

  const data = await res.json();

  const analysis      = mapToAppFormat(data, answers);
  const srProducts    = data.srProducts || null;
  const shelfAnalysis = data.shelfAnalysis || null;

  return { analysis, srProducts, shelfAnalysis };
}
