const mongoose = require('mongoose');

// One saved version of the admin-tunable AI settings for one task.
//   - The NEWEST version per key (createdAt) is the live one.
//   - No document for a key = the built-in default (services/aiConfig/defaults.js) is live.
//   - Versions are never edited or deleted. "Restore" inserts a NEW copy of an older version
//     (or of the built-in default) so the history stays a complete log.
const aiConfigVersionSchema = new mongoose.Schema({
  key: { type: String, enum: ['skin_analysis', 'score_reading', 'market_picks'], required: true },
  // Editable part of the prompt. The locked rules live in code, never here.
  guidance: { type: String, maxlength: 8000, default: '' },
  limits: {
    timeoutSec: Number,
    maxOutputTokens: Number,
    maxCostUsd: Number,
  },
  note: { type: String, maxlength: 200 },
  createdBy: String, // admin email
  // Set when this version is a restore: the id of the copied version, or 'default'.
  restoredFrom: { type: String, default: null },
}, { timestamps: true });

// "Newest per key" and the history list both read by key, newest first.
aiConfigVersionSchema.index({ key: 1, createdAt: -1 });

module.exports = mongoose.model('AiConfigVersion', aiConfigVersionSchema);
