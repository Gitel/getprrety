const mongoose = require('mongoose');

const rateLimitBucketSchema = new mongoose.Schema({
  scope: { type: String, enum: ['scan_ip', 'scan_global', 'ai_user'], required: true },
  key: { type: String, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});

rateLimitBucketSchema.index({ scope: 1, key: 1, windowStart: 1 }, { unique: true });
rateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitBucket', rateLimitBucketSchema);
