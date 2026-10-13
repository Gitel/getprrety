const { EventEmitter } = require('node:events');
const { ANALYSIS_SERVER_TIMEOUT_MS, RESPONSE_RESERVE_MS, logAnalysisPhase, startAnalysisDeadline } = require('./analysisDeadline');

function setup(timeoutMs = 1_000) {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableEnded = false;
  res.headersSent = false;
  res.destroyed = false;
  res.status = jest.fn(function (code) { this.statusCode = code; return this; });
  res.json = jest.fn(function (body) { this.body = body; this.writableEnded = true; return this; });
  startAnalysisDeadline(req, res, jest.fn(), { timeoutMs });
  return { req, res, deadline: req.analysisDeadline };
}

test('sets the 85 second deadline with a one second response reserve', () => {
  expect(ANALYSIS_SERVER_TIMEOUT_MS).toBe(85_000);
  expect(RESPONSE_RESERVE_MS).toBe(1_000);
});

test('setup telemetry uses ingress elapsed time and an explicit safe field allowlist', () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_250);
  logAnalysisPhase({ requestId: 'req-safe-1', startedAt: 1_000 }, 'prompt_ready', {
    messageCount: 2, status: 999, code: 'raw-error', rawPrompt: 'private content',
  });
  logAnalysisPhase({ requestId: 'req-safe-1', startedAt: 1_000 }, 'private_phase', { code: 'ANALYSIS_FAILED' });
  expect(log.mock.calls).toEqual([['analysis-setup', JSON.stringify({
    requestId: 'req-safe-1', phase: 'prompt_ready', elapsedMs: 250, messageCount: 2,
  })]]);
  now.mockRestore();
  log.mockRestore();
});

test('ingress and response finish are correlated by the same server request id', () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const { res, deadline } = setup();
  res.emit('finish');
  const records = log.mock.calls.map(([channel, value]) => ({ channel, ...JSON.parse(value) }));
  expect(records.map(record => record.phase)).toEqual(['ingress', 'response_finish']);
  expect(new Set(records.map(record => record.requestId))).toEqual(new Set([deadline.requestId]));
  log.mockRestore();
});

test('request abort cancels work with a cancellation reason', () => {
  const { req, deadline } = setup();
  req.emit('aborted');
  expect(deadline.controller.signal.aborted).toBe(true);
  expect(deadline.controller.signal.reason).toBe('CANCELLED');
});

test('normal response close does not cancel completed work and cleans up the deadline timer', () => {
  const { res, deadline } = setup();
  res.writableEnded = true;
  res.emit('finish');
  res.emit('close');
  expect(deadline.controller.signal.aborted).toBe(false);
});

test('disconnected response cancels work and marks the request abandoned', () => {
  const { res, deadline } = setup();
  res.writableEnded = false;
  res.emit('close');
  expect(deadline.disconnected).toBe(true);
  expect(deadline.controller.signal.reason).toBe('CANCELLED');
});

test('deadline expiration aborts work as a timeout', async () => {
  const { deadline } = setup(5);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(deadline.controller.signal.aborted).toBe(true);
  expect(deadline.controller.signal.reason).toBe('TIMEOUT');
});

test('deadline ends a request that has not reached its route with a sanitized response', async () => {
  const { deadline, res } = setup(5);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(deadline.controller.signal.aborted).toBe(true);
  expect(res.status).toHaveBeenCalledWith(504);
  expect(res.body).toEqual({ error: 'Analysis is unavailable' });
});
