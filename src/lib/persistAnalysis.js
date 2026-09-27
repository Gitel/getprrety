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
// srProducts / shelfAnalysis travel on `analysis` itself (see analyzeWithRailway.js) and
// are saved with it, so the Profile screen can show them again after a restart and
// admins can edit them; the server sanitizes both.
export async function persistAnalysis({ analysis, answers }) {
  if (!analysis) return;

  const scanClaimed = answers?.skinScanId && answers?.skinScanToken
    ? await claimScan(answers.skinScanId, answers.skinScanToken).catch(() => false)
    : false;

  const quizPhotoIds = await uploadAll(quizPhotoUris(answers));

  // One id for the whole save, generated outside withRetry so every attempt carries
  // the same key. Without it a lost response after a successful write produced a
  // second analysis record and a second clinic email; the server collapses same-key
  // writes into the original document.
  //
  // Degrades to the previous non-idempotent behavior rather than failing the save
  // outright: randomUUID is secure-context-only on web, so a plain-http staging or
  // LAN host has no crypto.randomUUID at all. The server treats null as "older
  // client" and falls back to a plain create.
  const clientRequestId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : null;

  // Retry a few times before giving up — a transient upload/API blip used to be
  // swallowed and the assessment silently lost. Callers treat a thrown error here
  // as "save failed" and warn the user rather than pretending it worked.
  // Resolves to the analysis as the server saved it (with its `_id`), or null. Callers
  // attach that `_id` to the in-memory analysis: resume refresh only replaces analyses
  // that carry an `_id` (see src/lib/resumeRefresh.js nextAnalysis), so without it clinic
  // edits would not reach the app for the rest of the session after a quiz.
  const response = await withRetry(() => api.post('/api/analysis', {
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
    clientRequestId,
    // 'gemini' | 'fallback' (+ why it failed). Lets the server mark generic results.
    source:         analysis.source ?? null,
    fallbackReason: analysis.fallbackReason ?? null,
    // Extra Gemini output. Saved so the product routine and shelf audit survive a
    // reload; null on a fallback. The server sanitizes these before storing them.
    srProducts:     analysis.srProducts ?? null,
    shelfAnalysis:  analysis.shelfAnalysis ?? null,
    safetyFlags:    analysis.safetyFlags ?? null,
    checkInPrompts: analysis.checkInPrompts ?? null,
    eventPrep:      analysis.eventPrep ?? null,
  }));
  return response?.analysis || null;
}

// Give the in-memory analysis the `_id` it was saved under, once, if it has none yet.
// Pure so both callers (LoadingScreen, SignUpScreen) share it and it can be tested.
// createdAt / firstReadingAt come along for the Profile score section's "Day N" label
// (src/lib/scoreReading.js); without them a fresh analysis shows Day 1 until a reload.
export function withSavedId(current, saved) {
  if (!current || current._id || !saved?._id) return current;
  return {
    ...current,
    _id: saved._id,
    ...(saved.createdAt ? { createdAt: saved.createdAt } : {}),
    ...(saved.firstReadingAt ? { firstReadingAt: saved.firstReadingAt } : {}),
  };
}

// Whether LoadingScreen skips saving a "Try again" (FallbackBanner) that fell back AGAIN.
// Normally skipped: the first fallback is already stored, or its save is still in flight,
// and a second copy would add a duplicate record and a second clinic email. Saved only
// when that first save is known to have failed (analysisSaveFailed), or nothing would
// ever be stored (owner decision). A retry that succeeds is always saved.
// Known gap: the Profile "couldn't save" banner's dismiss button also clears the flag.
export function skipRetrySave({ isRetry, result, firstSaveFailed }) {
  return Boolean(isRetry && result?.source === 'fallback' && !firstSaveFailed);
}
