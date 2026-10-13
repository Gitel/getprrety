const mongoose = require('mongoose');

const rateLimitBucketSchema = new mongoose.Schema({
  // Keep this documentation enum in sync with every feature that allocates a rate-limit scope.
  // auth_admin = /admin sign-in throttle, msg_user = in-app message replies per user,
  // auth_link = sign-in link redeem throttle, link_send = admin "send link" emails.
  // auth_login / auth_signup / auth_google were already used by services/authRateLimit.js but
  // were missing here. booking_slots / booking_create are used by routes/bookings.js.
  // analysis_ip / analysis_global provide separate hourly budgets for Bedrock analysis calls.
  // NOTE: this enum only DOCUMENTS the scopes in use. consumeRateLimit upserts without running
  // validators, so it is not enforced - keep it in sync by hand when adding a scope.
  scope: { type: String, enum: ['scan_ip', 'scan_global', 'analysis_ip', 'analysis_global', 'ai_user', 'auth_admin', 'msg_user', 'auth_login', 'auth_signup', 'auth_google', 'auth_link', 'link_send', 'booking_slots', 'booking_create'], required: true },
  key: { type: String, required: true },
  windowStart: { type: Date, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});

rateLimitBucketSchema.index({ scope: 1, key: 1, windowStart: 1 }, { unique: true });
rateLimitBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitBucket', rateLimitBucketSchema);
