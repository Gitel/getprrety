const crypto = require('node:crypto');
const { consumeRateLimit } = require('../rateLimit');

const PER_IP_LIMIT = Number(process.env.SKIN_SCAN_PER_IP_HOURLY_LIMIT || 3);
const GLOBAL_LIMIT = Number(process.env.SKIN_SCAN_GLOBAL_HOURLY_LIMIT || 100);

// Hashed IP keys keep the separately budgeted paid-analysis buckets from storing raw addresses.
async function enforceAnalysisBudget(ip, {
  secret = process.env.JWT_SECRET,
  consume = consumeRateLimit,
  perIpLimit = PER_IP_LIMIT,
  globalLimit = GLOBAL_LIMIT,
} = {}) {
  if (!secret) throw new Error('Analysis budget is unavailable');
  const key = crypto.createHmac('sha256', secret).update(String(ip || 'unknown')).digest('hex');
  if (!await consume('analysis_ip', key, perIpLimit)) return false;
  return consume('analysis_global', 'all', globalLimit);
}

module.exports = { PER_IP_LIMIT, GLOBAL_LIMIT, enforceAnalysisBudget };
