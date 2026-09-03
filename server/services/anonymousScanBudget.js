const { consumeRateLimit } = require('./rateLimit');

function rateLimitError() {
  const err = new Error('Skin scan rate limit exceeded');
  err.status = 429;
  return err;
}

// Budget guard for the anonymous (pre-signup) skin-scan endpoints. The per-IP check
// runs first and short-circuits: an IP that has blown its own hourly allowance is
// rejected WITHOUT touching the shared global counter, so one abusive client can no
// longer drain the global quota for everyone. Only requests within their per-IP
// allowance draw down the global budget.
async function enforceAnonymousScanBudget(keyHash, {
  perIpLimit = Number(process.env.SKIN_SCAN_PER_IP_HOURLY_LIMIT || 3),
  globalLimit = Number(process.env.SKIN_SCAN_GLOBAL_HOURLY_LIMIT || 100),
} = {}) {
  const perIpAllowed = await consumeRateLimit('scan_ip', keyHash, perIpLimit);
  if (!perIpAllowed) throw rateLimitError();

  const globalAllowed = await consumeRateLimit('scan_global', 'all', globalLimit);
  if (!globalAllowed) throw rateLimitError();
}

module.exports = { enforceAnonymousScanBudget };
