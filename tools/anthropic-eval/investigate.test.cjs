const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AUTHORIZED_CASE_IDS, ACCEPTANCE_TIMEOUT_MS, assertAuthorizedCaseFolders, runInvestigation, safeEvent, writeAtomicCheckpoint } = require('./investigate.cjs');
const { ANALYSIS_SERVER_TIMEOUT_MS, RESPONSE_RESERVE_MS } = require('../../server/services/anthropic/analysisDeadline');

const usage = { prompt_tokens: 100, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 20 } };
const tasks = [false, true, true].map((stream, index) => ({ label: `configuration-${index}`, stream, compact: index === 2, timeoutMs: 90000, language: 'en', testCase: { caseId: 'case-fixture', quiz: { name: 'PRIVATE_INPUT' }, images: [] } }));
const validateImpl = () => ({ errors: [] });

test('compares separately labelled calls once and omits private input/output and credential values', async () => {
  const calls = [];
  const report = await runInvestigation({ tasks, catalogue: [], token: 'PRIVATE_CREDENTIAL', validateImpl,
    completeImpl: async options => {
      calls.push(options);
      options.onEvent({ phase: 'usage', elapsedMs: 10, usage, rawContent: 'PRIVATE_PROVIDER_BODY' });
      return { privateResult: 'PRIVATE_OUTPUT' };
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(report.results.every(result => result.valid), true);
  assert.equal(calls[0].system, calls[1].system);
  assert.notEqual(calls[1].system, calls[2].system);
  for (const secret of ['PRIVATE_INPUT', 'PRIVATE_CREDENTIAL', 'PRIVATE_OUTPUT', 'PRIVATE_PROVIDER_BODY']) assert.equal(JSON.stringify(report).includes(secret), false);
});

test('unknown cost stops before another paid request without retrying a timeout', async () => {
  let calls = 0;
  const report = await runInvestigation({ tasks, catalogue: [], token: 'test-token', validateImpl,
    completeImpl: async () => { calls++; throw Object.assign(new Error('PRIVATE_FAILURE'), { code: 'ANTHROPIC_TIMEOUT' }); },
  });
  assert.equal(calls, 1);
  assert.equal(report.results[0].status, 'ANTHROPIC_TIMEOUT');
  assert.equal(report.results[0].costUsd, null);
  assert.equal(report.stopReason, 'unknown provider cost');
  assert.equal(JSON.stringify(report).includes('PRIVATE_FAILURE'), false);
});

test('known over-cap usage stops the study even when a candidate is returned', async () => {
  const report = await runInvestigation({ tasks, catalogue: [], token: 'test-token', validateImpl,
    completeImpl: async options => { options.onEvent({ phase: 'usage', usage: { prompt_tokens: 1000000, completion_tokens: 0 } }); return {}; },
  });
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].valid, false);
  assert.equal(report.stopReason, 'observed cost ceiling reached');
});

test('malformed cached usage cannot become a known zero-cache charge', async () => {
  const report = await runInvestigation({ tasks, catalogue: [], token: 'test-token', validateImpl,
    completeImpl: async options => { options.onEvent({ phase: 'usage', usage: { ...usage, prompt_tokens_details: { cached_tokens: 'invalid' } } }); return {}; },
  });
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].costUnknown, true);
});

test('semantic validation failure is retained without exposing its private details', async () => {
  const report = await runInvestigation({ tasks: tasks.slice(0, 1), catalogue: [], token: 'test-token', validateImpl: () => ({ errors: ['PRIVATE_VALIDATION_DETAIL'] }),
    completeImpl: async options => { options.onEvent({ phase: 'usage', usage }); return {}; },
  });
  assert.equal(report.results[0].valid, false);
  assert.equal(report.results[0].semanticErrorCount, 1);
  assert.equal(JSON.stringify(report).includes('PRIVATE_VALIDATION_DETAIL'), false);
});

test('telemetry uses bounded phase and numeric allowlists', () => {
  assert.equal(safeEvent({ phase: 'PRIVATE_BODY' }), null);
  assert.deepEqual(safeEvent({ phase: 'headers', elapsedMs: 4, status: 200, error: 'PRIVATE_BODY', contentBytes: -1 }), { phase: 'headers', elapsedMs: 4, httpStatus: 200 });
  assert.deepEqual(safeEvent({ phase: 'complete', finishReason: 'end_turn' }), { phase: 'complete', finishReason: 'end_turn' });
  assert.deepEqual(safeEvent({ phase: 'complete', finishReason: 'stop' }), { phase: 'complete', finishReason: 'stop' });
  assert.deepEqual(safeEvent({ phase: 'headers', status: 2000 }), { phase: 'headers' });
});

test('acceptance requires exactly the six authorized case folders and derives its timeout from the server deadline', () => {
  assert.doesNotThrow(() => assertAuthorizedCaseFolders(AUTHORIZED_CASE_IDS));
  assert.throws(() => assertAuthorizedCaseFolders(AUTHORIZED_CASE_IDS.slice(1)), /exactly the six authorized case folders/);
  assert.throws(() => assertAuthorizedCaseFolders([...AUTHORIZED_CASE_IDS, 'case-extra']), /exactly the six authorized case folders/);
  assert.equal(ACCEPTANCE_TIMEOUT_MS, ANALYSIS_SERVER_TIMEOUT_MS - RESPONSE_RESERVE_MS);
});

test('checkpoints unknown in-flight cost before a paid call and retains the result before stopping', async () => {
  const order = [];
  const checkpoints = [];
  let calls = 0;
  const report = await runInvestigation({ tasks, catalogue: [], token: 'test-token', validateImpl,
    onCheckpoint: async snapshot => { checkpoints.push(JSON.parse(JSON.stringify(snapshot))); order.push(`checkpoint:${snapshot.results.at(-1)?.status || 'metadata'}`); },
    completeImpl: async () => { calls++; order.push('paid-call'); throw Object.assign(new Error('PRIVATE_FAILURE'), { code: 'ANTHROPIC_TIMEOUT' }); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(order.slice(0, 3), ['checkpoint:metadata', 'checkpoint:in_flight', 'paid-call']);
  assert.equal(checkpoints[1].results[0].costUnknown, true);
  assert.equal(checkpoints[1].results[0].status, 'in_flight');
  assert.equal(checkpoints.at(-1).results[0].status, 'ANTHROPIC_TIMEOUT');
  assert.equal(checkpoints.at(-1).results[0].costUnknown, true);
  assert.equal(checkpoints.at(-1).stopReason, 'unknown provider cost');
  assert.equal(JSON.stringify(checkpoints).includes('PRIVATE_FAILURE'), false);
});

test('checkpoint failure prevents a provider call from starting', async () => {
  let calls = 0;
  await assert.rejects(runInvestigation({ tasks, catalogue: [], token: 'test-token', validateImpl,
    onCheckpoint: async () => { throw new Error('checkpoint failed'); },
    completeImpl: async () => { calls++; return {}; },
  }), /checkpoint failed/);
  assert.equal(calls, 0);
});

test('atomic checkpoint replaces an owned report and leaves valid JSON with no temporary sibling', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-checkpoint-'));
  const outputFile = path.join(directory, 'report.json');
  try {
    assert.equal(path.dirname(path.resolve(outputFile)), path.resolve(directory));
    const placeholder = await fs.open(outputFile, 'wx');
    await placeholder.writeFile('preflight placeholder');
    await placeholder.close();
    await writeAtomicCheckpoint(outputFile, { checkpoint: 1 });
    assert.deepEqual(JSON.parse(await fs.readFile(outputFile, 'utf8')), { checkpoint: 1 });
    await writeAtomicCheckpoint(outputFile, { checkpoint: 2 });
    assert.deepEqual(JSON.parse(await fs.readFile(outputFile, 'utf8')), { checkpoint: 2 });
    assert.deepEqual(await fs.readdir(directory), ['report.json']);
  } finally {
    if (path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir())) {
      await fs.unlink(outputFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await fs.rmdir(directory);
    }
  }
});
