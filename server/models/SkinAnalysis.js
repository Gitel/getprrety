const mongoose = require('mongoose');

const skinAnalysisSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  skinScanId:  { type: mongoose.Schema.Types.ObjectId, ref: 'SkinScan', default: null },
  eraId:       { type: String, required: true },
  era:         { type: mongoose.Schema.Types.Mixed },
  skinAnalysis:{ type: String },
  keyInsights: [String],
  productAudit:{ type: mongoose.Schema.Types.Mixed },
  routine:     { type: mongoose.Schema.Types.Mixed },
  affirmation: { type: String },
  quizAnswers:  { type: mongoose.Schema.Types.Mixed },
  quizPhotoIds: [String],

  // Acquisition channel this client came through, e.g. "lu_clinic" — captured from the
  // ?ref= param on the welcome screen and carried through quizAnswers. null = organic/unknown.
  referralSource:   { type: String, default: null },
  // Idempotency guard for the clinic notification email — null until the email has been sent.
  clinicNotifiedAt: { type: Date, default: null },
  // Why the most recent notification attempt failed. Null when it has never failed or
  // when the latest attempt succeeded. Purely diagnostic: it is what makes a silent mail
  // outage visible on /admin instead of only in pm2 logs.
  clinicNotifyError: { type: String, default: null },
  // Placeholder for a future explicit consent step; every quiz completion is currently
  // assumed to consent to sharing their profile with the clinic.
  consentToShare:   { type: Boolean, default: true },

  // Client-generated idempotency key for one save attempt, shared across all of
  // that attempt's retries. Null for older clients, which fall back to the
  // previous non-idempotent behavior.
  clientRequestId:  { type: String, default: null },

  // Where this result came from:
  //  - 'gemini'   the Railway/Gemini analysis succeeded;
  //  - 'fallback' it failed, and the client showed the canned buildFallback() template
  //               from src/constants.js instead (same text and routine for everyone);
  //  - null       saved by an older client, before this was recorded.
  // Without this a fallback looked exactly like a real analysis on /admin, in the clinic
  // email and in the app, which is how a months-long Gemini outage went unnoticed.
  source:         { type: String, enum: ['gemini', 'fallback', null], default: null },
  // Why the Gemini analysis failed (e.g. "Railway API 404"). Diagnostic only.
  fallbackReason: { type: String, default: null },

  // Extra Gemini/Railway output. Before these were stored they lived only in React state,
  // so the product routine (Morning/Evening SR products) and the shelf audit vanished on
  // the next reload. Shapes are owned by the Railway service, hence Mixed. All null for
  // fallback results and for documents saved by older clients.
  srProducts:     { type: mongoose.Schema.Types.Mixed, default: null }, // product-matched AM/PM routine
  shelfAnalysis:  { type: mongoose.Schema.Types.Mixed, default: null }, // audit of the user's shelf photos
  safetyFlags:    { type: mongoose.Schema.Types.Mixed, default: null }, // stored only, not displayed yet
  checkInPrompts: { type: mongoose.Schema.Types.Mixed, default: null }, // stored only, not displayed yet
  eventPrep:      { type: mongoose.Schema.Types.Mixed, default: null }, // stored only, not displayed yet
}, { timestamps: true });

// Partial so the many legacy and older-client rows with clientRequestId: null don't
// collide with each other — only real string keys are constrained.
skinAnalysisSchema.index(
  { userId: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } }
);

module.exports = mongoose.model('SkinAnalysis', skinAnalysisSchema);
