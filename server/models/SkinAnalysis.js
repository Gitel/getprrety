const mongoose = require('mongoose');

const skinAnalysisSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  eraId:       { type: String, required: true },
  era:         { type: mongoose.Schema.Types.Mixed },
  skinAnalysis:{ type: String },
  keyInsights: [String],
  productAudit:{ type: mongoose.Schema.Types.Mixed },
  routine:     { type: mongoose.Schema.Types.Mixed },
  affirmation: { type: String },
  quizAnswers:  { type: mongoose.Schema.Types.Mixed },
  quizPhotoIds: [String],
}, { timestamps: true });

module.exports = mongoose.model('SkinAnalysis', skinAnalysisSchema);
