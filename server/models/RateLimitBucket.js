const mongoose = require('mongoose');

const rateLimitBucketSchema = new mongoose.Schema({
  // analysis_ip/global are separate hourly budgets for paid, anonymous Bedrock analysis calls.
  scope: { type: String, enum: ['scan_ip', 'scan_global', 'analysis_ip', 'analysis_global', 'ai_user', 'auth_admin', 'msg_user'], required: true },
  key: { type: String, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});

rateLimitBucketSchema.index({ scope: 1, key: 1, windowStart: 1 }, { unique: true });
rateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitBucket', rateLimitBucketSchema);
