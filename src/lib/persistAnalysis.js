import { api } from './api';
import { uploadAll } from './uploadImage';
import { claimScan } from './skinScan';
import { sanitizeQuizAnswers } from './sanitizeQuizAnswers';
import { withRetry } from './retry';

// The quiz photo set, in the order the analysis expects. Same list the pre-signup
// path already uploaded — authenticated completions and retakes go through here too
// now, so their photos are no longer dropped on the floor.
export function quizPhotoUris(answers) {
  return [
    answers?.front,
    answers?.left,
    answers?.right,
    answers?.closeup,
    answers?.neck,
    ...(answers?.shelf_photos || []),
  ].filter(Boolean);
}

// Single writer for POST /api/analysis. Used by both the authenticated LoadingScreen
// path and the post-signup SignUpScreen path so the payload — quizPhotoIds included —
// stays identical.
export async function persistAnalysis({ analysis, answers }) {
  if (!analysis) return;

  const scanClaimed = answers?.skinScanId && answers?.skinScanToken
    ? await claimScan(answers.skinScanId, answers.skinScanToken).catch(() => false)
    : false;

  const quizPhotoIds = await uploadAll(quizPhotoUris(answers));

  // Retry a few times before giving up — a transient upload/API blip used to be
  // swallowed and the assessment silently lost. Callers treat a thrown error here
  // as "saved failed" and warn the user rather than pretending it worked.
  await withRetry(() => api.post('/api/analysis', {
    eraId:        analysis.era?.id ?? analysis.eraId,
    era:          analysis.era,
    skinAnalysis: analysis.skinAnalysis,
    keyInsights:  analysis.keyInsights,
    productAudit: analysis.productAudit,
    routine:      analysis.routine,
    affirmation:  analysis.affirmation,
    quizAnswers:  sanitizeQuizAnswers(answers),
    quizPhotoIds,
    skinScanId:   scanClaimed ? answers.skinScanId : null,
  }));
}
