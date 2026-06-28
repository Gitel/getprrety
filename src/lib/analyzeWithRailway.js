import { ERAS, fallbackEra } from '../constants';

const RAILWAY_URL = 'https://getpretty-api-production.up.railway.app';

// Map app quiz answer fields → Railway API schema
function buildQuizPayload(answers) {
  const concernMap = {
    acne:        'breakouts',
    wrinkles:    'fine_lines',
    pigmentation:'dark_spots',
    sensitive:   'sensitive',
    dryness:     'dryness',
    pores:       'pores',
  };
  const productMap = {
    cleanser:     'cleanser',
    moisturizer:  'moisturizer',
    serum:        'serum',
    treatments:   'treatments',
    spf:          'sunscreen',
    none:         'not_much',
  };

  const concerns = (answers.concerns || []).map(c => concernMap[c] || c);
  const products = (answers.routine_products || []).map(p => productMap[p] || p);
  const hasPhotos = ['photo_right', 'photo_left', 'photo_front'].some(k => answers[k]);

  return {
    identity:            answers.gender || 'she/her',
    age_range:           answers.age || '25-34',
    fitzpatrick:         Number(answers.tone) || 2,
    concerns,
    current_products:    products,
    smokes:              answers.smoke || 'no',
    has_diabetes:        answers.diabetes || 'no',
    allergies:           answers.allergies || ['none'],
    pregnant_or_ttc:     answers.pregnant || 'no',
    name:                answers.name || null,
    interests:           answers.interests || [],
    event_type:          answers.event_type || 'none',
    event_date:          answers.event_date || null,
    dream_skin_era:      answers.goals || '',
    skin_photos_uploaded: hasPhotos,
    shelf_photos_uploaded: (answers.shelf_photos || []).length > 0,
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
    await Promise.all(['photo_right', 'photo_left', 'photo_front'].map(k => toBase64(answers[k])))
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
