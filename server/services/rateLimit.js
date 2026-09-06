const RateLimitBucket = require('../models/RateLimitBucket');

async function increment(scope, key, windowStart, expiresAt, upsert = true) {
  try {
    return await RateLimitBucket.findOneAndUpdate(
      { scope, key, windowStart },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Two first requests can race on a new unique bucket. Retry as a plain atomic increment.
    if (err.code === 11000 && upsert) return increment(scope, key, windowStart, expiresAt, false);
    throw err;
  }
}

async function consumeRateLimit(scope, key, limit, windowMs = 60 * 60 * 1000) {
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit) || numericLimit < 1) throw new Error(`Invalid rate limit for ${scope}`);
  const startMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(startMs);
  const expiresAt = new Date(startMs + 2 * windowMs);
  const bucket = await increment(scope, String(key), windowStart, expiresAt);
  return bucket.count <= numericLimit;
}

// Give back a unit that a pre-flight check consumed for what turned out to be a
// legitimate, successful request. The auth endpoints have to consume before doing
// the work — bcrypt at cost 12 must be capped before it runs, not after — so
// without a refund a shared address (a clinic's Wi-Fi, any CGNAT pool) spends its
// whole budget on real signups and locks out the very users we want.
async function refundRateLimit(scope, key, windowMs = 60 * 60 * 1000) {
  const startMs = Math.floor(Date.now() / windowMs) * windowMs;
  // count > 0 keeps a refund that straddles a window boundary from pushing a fresh
  // bucket negative and handing out a free attempt.
  await RateLimitBucket.updateOne(
    { scope, key: String(key), windowStart: new Date(startMs), count: { $gt: 0 } },
    { $inc: { count: -1 } }
  );
}

module.exports = { consumeRateLimit, refundRateLimit };
