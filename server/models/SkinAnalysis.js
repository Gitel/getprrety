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
  // Placeholder for a future explicit consent step; every quiz completion is currently
  // assumed to consent to sharing their profile with the clinic.
  consentToShare:   { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('SkinAnalysis', skinAnalysisSchema);
