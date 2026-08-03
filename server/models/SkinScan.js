const mongoose = require('mongoose');

// PerfectCorp photo-analysis job. Deliberately NOT named SkinAnalysis — that model already stores
// the Gemini-decided Skin Era result (server/models/SkinAnalysis.js, server/routes/analysis.js).
// Created before the user has an account (userId is null until claimed at signup), mirroring how
// quizAnswers/quizPhotoIds already live in client-side context until SignUpScreen persists them.
const taskSchema = new mongoose.Schema({
  angle: { type: String, enum: ['front', 'left', 'right'], required: true },
  fileId: String,
  taskId: String,
  status: { type: String, enum: ['pending', 'processing', 'success', 'error', 'skipped'], default: 'pending' },
  error: String,
}, { _id: false });

const skinScanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  accessTokenHash: { type: String, required: true, select: false },
  requestIpHash: { type: String, required: true, select: false },
  status: {
    type: String,
    enum: ['awaiting_upload', 'starting', 'processing', 'complete', 'failed', 'partial'],
    default: 'awaiting_upload',
  },
  tasks: [taskSchema],
  normalized: { type: mongoose.Schema.Types.Mixed, default: {} }, // { front, left, right } per-angle NormalizedAnalysis
  merged: { type: mongoose.Schema.Types.Mixed, default: null },
  quizSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  fusion: { type: mongoose.Schema.Types.Mixed, default: null }, // { concerns, skinType, discoveries, contradictions }
  sidePhotoAnalysisEnabled: { type: Boolean, default: true },
  bandsVersion: { type: String, default: 'v1' },
  fusionVersion: { type: String, default: '1.0' },
  unitsConsumed: { type: Number, default: 0 },
  failureReason: String,
  completedAt: Date,
}, { timestamps: true });

skinScanSchema.index({ userId: 1, createdAt: -1 });
skinScanSchema.index({ status: 1, createdAt: 1 });
skinScanSchema.index({ requestIpHash: 1, createdAt: -1 });

module.exports = mongoose.model('SkinScan', skinScanSchema);
