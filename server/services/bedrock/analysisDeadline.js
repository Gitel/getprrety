const { randomUUID } = require('node:crypto');

const ANALYSIS_SERVER_TIMEOUT_MS = 85_000;
const RESPONSE_RESERVE_MS = 1_000;
const SETUP_PHASES = new Set([
  'ingress', 'parsed', 'budget_start', 'budget_complete', 'catalogue_loaded', 'prompt_ready',
  'provider_start', 'semantic_validated', 'semantic_invalid', 'route_error', 'timeout',
  'disconnect', 'response_finish',
]);

function logAnalysisPhase(deadline, phase, metrics = {}) {
  if (!deadline || !SETUP_PHASES.has(phase)) return;
  // This setup clock starts at HTTP ingress; provider events use their own providerElapsedMs clock.
  const record = { requestId: deadline.requestId, phase, elapsedMs: Math.max(0, Date.now() - deadline.startedAt) };
  if (Number.isSafeInteger(metrics.status) && metrics.status >= 100 && metrics.status <= 599) record.status = metrics.status;
  if (Number.isSafeInteger(metrics.imageCount) && metrics.imageCount >= 0 && metrics.imageCount <= 10) record.imageCount = metrics.imageCount;
  if (Number.isSafeInteger(metrics.quizBytes) && metrics.quizBytes >= 0 && metrics.quizBytes <= 32 * 1024) record.quizBytes = metrics.quizBytes;
  if (Number.isSafeInteger(metrics.catalogueCount) && metrics.catalogueCount >= 0 && metrics.catalogueCount <= 50_000) record.catalogueCount = metrics.catalogueCount;
  if (Number.isSafeInteger(metrics.messageCount) && metrics.messageCount >= 0 && metrics.messageCount <= 100) record.messageCount = metrics.messageCount;
  if (typeof metrics.code === 'string' && /^(BEDROCK_[A-Z0-9_]+|ANALYSIS_[A-Z0-9_]+|INVALID_INPUT|RATE_LIMITED)$/.test(metrics.code)) record.code = metrics.code;
  console.info('analysis-setup', JSON.stringify(record));
}

// Install before JSON parsing so request upload time counts against the server-side ceiling.
function startAnalysisDeadline(req, res, next, { timeoutMs = ANALYSIS_SERVER_TIMEOUT_MS, now = Date.now } = {}) {
  const controller = new AbortController();
  const startedAt = now();
  const deadline = {
    requestId: randomUUID(),
    startedAt,
    expiresAt: startedAt + timeoutMs,
    controller,
    disconnected: false,
  };
  req.analysisDeadline = deadline;

  const disconnect = () => {
    deadline.disconnected = true;
    controller.abort('CANCELLED');
    clearTimeout(timer);
  };
  const onAborted = () => {
    if (deadline.disconnected) return;
    disconnect();
    logAnalysisPhase(deadline, 'disconnect');
  };
  const onClose = () => {
    if (!res.writableEnded && !deadline.disconnected) {
      disconnect();
      logAnalysisPhase(deadline, 'disconnect');
    }
    cleanup();
  };
  const onFinish = () => {
    logAnalysisPhase(deadline, 'response_finish', { status: res.statusCode });
    cleanup();
  };
  const cleanup = () => {
    clearTimeout(timer);
    req.removeListener('aborted', onAborted);
    res.removeListener('finish', onFinish);
    res.removeListener('close', onClose);
  };
  const timer = setTimeout(() => {
    controller.abort('TIMEOUT');
    logAnalysisPhase(deadline, 'timeout', { status: 504 });
    // A stalled body parser never reaches the route, so finish the request with a safe timeout response here.
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      res.status(504).json({ error: 'Analysis is unavailable' });
    }
  }, timeoutMs);
  timer.unref?.();
  req.once('aborted', onAborted);
  res.once('finish', onFinish);
  res.once('close', onClose);
  logAnalysisPhase(deadline, 'ingress');
  next();
}

module.exports = { ANALYSIS_SERVER_TIMEOUT_MS, RESPONSE_RESERVE_MS, logAnalysisPhase, startAnalysisDeadline };
