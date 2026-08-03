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

module.exports = { consumeRateLimit };
