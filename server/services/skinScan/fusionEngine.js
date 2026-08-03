// Quiz-anchored fusion: the quiz is the anchor, the photo adjusts severity by at most one level.
// Grounded in the real quiz option values (src/constants.js `skin_goals` / `top_concern` /
// `post_cleanse_feel`) rather than the integration spec's illustrative table.
const FUSION_VERSION = '1.0';

const CONCERN_TO_GOALS = {
  acne: ['acne', 'acne_scars'],
  pore: ['large_pores'],
  texture: ['uneven_texture'],
  redness: ['redness', 'rosacea', 'sensitive'],
  oiliness: ['oiliness'],
  moisture: ['dryness', 'dehydration'],
  radiance: ['dull_skin'],
  wrinkle: ['fine_lines', 'wrinkles', 'neck_aging'],
};

const REPORTED_SKIN_TYPE_LABEL = {
  dry: 'Dry',
  comfortable: 'Comfortable',
  oily: 'Oily',
  oily_tzone: 'Combination (Oily T-zone)',
  tight_then_oily: 'Dehydrated / Combination',
  not_sure: 'Unsure',
};

function quizBaselineSeverity(concernKey, answers = {}) {
  const mapped = CONCERN_TO_GOALS[concernKey] || [];
  const goals = answers.skin_goals || [];
  const isTopConcern = mapped.includes(answers.top_concern);
  const hasGoal = mapped.some(g => goals.includes(g));
  if (isTopConcern) return 3;
  if (hasGoal) return 2;
  return 1; // neutral prior — concern not mentioned
}

// The API can move a concern by at most one level in either direction. A user who has known her
// skin for 20 years is never told a photo overrides her — this is what protects trust.
function fuse(quizSeverity, apiSeverity) {
  const delta = Math.max(-1, Math.min(1, apiSeverity - quizSeverity));
  return Math.max(0, Math.min(4, quizSeverity + delta));
}

function agreementFor(quizSeverity, apiSeverity) {
  const diff = apiSeverity - quizSeverity;
  if (diff === 0) return 'aligned';
  if (diff === 1) return 'api_higher';
  if (diff === -1) return 'api_lower';
  return 'contradiction';
}

function resolveSkinType(reportedKey, observed = {}) {
  const reported = REPORTED_SKIN_TYPE_LABEL[reportedKey] || null;
  const dryLeaning = reportedKey === 'dry' || reportedKey === 'tight_then_oily';
  if (dryLeaning && observed.tZone === 'Oily') {
    return { reported, observed: observed.whole || null, resolved: 'dehydrated_combination',
      tZone: observed.tZone, uZone: observed.uZone || null };
  }
  return {
    reported,
    observed: observed.whole || null,
    resolved: observed.whole ? observed.whole.toLowerCase().replace(/\s+/g, '_') : reportedKey || null,
    tZone: observed.tZone || null,
    uZone: observed.uZone || null,
  };
}

// concerns: normalized/merged PerfectCorp concern map { key: { raw, ui, severity } }
function runFusion({ answers = {}, concerns = {}, skinType = {} } = {}) {
  const rows = [];
  const discoveries = [];
  const contradictions = [];
  const skinTypeResolved = resolveSkinType(answers.post_cleanse_feel, skinType);

  const keys = Object.keys(CONCERN_TO_GOALS);
  for (const key of keys) {
    const apiEntry = concerns[key];
    const quizSeverity = quizBaselineSeverity(key, answers);

    if (!apiEntry) {
      rows.push({ key, quizSeverity, apiSeverity: null, severity: quizSeverity, agreement: 'quiz_only' });
      continue;
    }

    const apiSeverity = apiEntry.severity;
    const severity = fuse(quizSeverity, apiSeverity);
    const agreement = agreementFor(quizSeverity, apiSeverity);

    rows.push({
      key, quizSeverity, apiSeverity, severity, agreement,
      uiScore: apiEntry.ui, maskUrl: apiEntry.maskUrl || null,
    });

    if (apiSeverity >= 3 && quizSeverity <= 1) {
      discoveries.push({ key, severity: apiSeverity, copyKey: `discovery.${key}.mild` });
    }
    if (agreement === 'contradiction') {
      contradictions.push({ key, quiz: quizSeverity, api: apiSeverity, resolution: skinTypeResolved.resolved });
    }
  }

  rows.sort((a, b) => b.severity - a.severity);
  rows.forEach((r, i) => { r.rank = i + 1; });

  return {
    concerns: rows,
    skinType: skinTypeResolved,
    discoveries,
    contradictions,
    fusionVersion: FUSION_VERSION,
  };
}

module.exports = {
  FUSION_VERSION, CONCERN_TO_GOALS, quizBaselineSeverity, fuse, agreementFor, resolveSkinType, runFusion,
};
