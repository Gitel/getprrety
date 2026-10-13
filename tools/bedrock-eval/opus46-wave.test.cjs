const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runWave, stopAfterAnalysis, buildManifest, MAX_MANIFEST_ROWS } = require('./opus46-wave.cjs');
const { safeProviderFailure } = require('./opus46.cjs');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opus46-wave-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function readOption(args, name) {
  return args[args.indexOf(name) + 1];
}

test('wave checkpoints each inference before the single paid-call boundary and keeps only safe metrics', async t => {
  const directory = await temporaryDirectory(t);
  const checkpoint = path.join(directory, 'wave.json');
  const calls = [];
  const result = await runWave({ inputDir: directory, outputFile: checkpoint, getTokenImpl: () => 'secret-token',
    caseIds: ['case-568f7d2ab3'], languages: ['en', 'he'], runCaseImpl: async (args) => {
      const mode = readOption(args, '--mode');
      const output = readOption(args, '--output');
      const caseId = readOption(args, '--case-id');
      const language = readOption(args, '--language');
      calls.push({ mode, caseId, language });
      if (mode === 'count') {
        await fs.writeFile(output, '{}');
        return { mode: 'count', status: 'counted', caseId, language, imageCount: 0, inputTokens: 1234,
          outputTokenLimit: 8000, estimatedInputCostUsd: 0.0068, providerRequestId: 'request-1', rawQuiz: 'private-quiz' };
      }
      const saved = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
      assert.equal(saved.phase, 'inference');
      assert.equal(saved.countedRows, 2);
      const currentRow = saved.results.find(row => row.caseId === caseId && row.language === language);
      assert.equal(currentRow.status, 'in_flight');
      assert.equal(currentRow.costUnknown, true);
      assert.equal(readOption(args, '--count-report'), output.replace('.analysis.json', '.count.json'));
      return { mode: 'analysis', status: language === 'en' ? 'failed' : 'valid',
        failureCategory: language === 'en' ? 'validation' : undefined, caseId, language, imageCount: 0,
        usage: { inputTokens: 1234, outputTokens: 300, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
        costUsd: 0.015, costUnknown: false, schemaErrorCount: 0, semanticErrorCount: language === 'en' ? 1 : 0,
        outputBytes: 1200, elapsedMs: 900, totalMs: 1000, rawOutput: 'private-model-output' };
    } });

  assert.deepEqual(calls.map(call => [call.mode, call.caseId, call.language]), [
    ['count', 'case-568f7d2ab3', 'en'], ['count', 'case-568f7d2ab3', 'he'],
    ['analysis', 'case-568f7d2ab3', 'en'], ['analysis', 'case-568f7d2ab3', 'he'],
  ]);
  assert.equal(result.status, 'complete');
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[1].status, 'valid');
  const saved = await fs.readFile(checkpoint, 'utf8');
  for (const privateValue of ['secret-token', 'private-quiz', 'private-model-output', 'rawOutput']) assert.equal(saved.includes(privateValue), false);
});

test('wave stops before another analysis when the previous cost is unknown', async t => {
  const directory = await temporaryDirectory(t);
  const checkpoint = path.join(directory, 'wave.json');
  let calls = 0;
  const result = await runWave({ inputDir: directory, outputFile: checkpoint, getTokenImpl: () => 'token',
    caseIds: ['case-568f7d2ab3', 'case-80fd909fc6'], languages: ['en'], runCaseImpl: async args => {
      calls += 1;
      const mode = readOption(args, '--mode');
      if (mode === 'count') {
        await fs.writeFile(readOption(args, '--output'), '{}');
        return { status: 'counted', caseId: readOption(args, '--case-id'), language: 'en', inputTokens: 1000, outputTokenLimit: 1000 };
      }
      return { status: 'failed', failureCategory: 'response', caseId: readOption(args, '--case-id'), language: 'en', costUsd: null, costUnknown: true };
    } });

  assert.equal(calls, 3);
  assert.equal(result.stopReason, 'unknown_cost');
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].status, 'counted');
  assert.equal(result.attemptedInferenceCount, 1);
  assert.equal(result.results[0].costUnknown, true);
});

test('stop policy allows known validation failures to proceed but stops other failures', () => {
  assert.equal(stopAfterAnalysis({ costUsd: 0.1, costUnknown: false, failureCategory: 'validation' }, 0.1), null);
  assert.equal(stopAfterAnalysis({ costUsd: 0.1, costUnknown: false, failureCategory: 'service' }, 0.1), 'service');
  assert.equal(stopAfterAnalysis({ costUsd: 0.3, costUnknown: false }, 0.3), 'case_cost_ceiling');
});

test('external manifest supports the public packaging fixture from its own input folder', async t => {
  const directory = await temporaryDirectory(t);
  const pilot = path.join(directory, 'pilot-six');
  const publicInput = path.join(directory, 'public-packaging');
  const manifestFile = path.join(directory, 'manifest.json');
  const checkpoint = path.join(directory, 'wave.json');
  const rows = [
    { caseId: 'case-568f7d2ab3', language: 'en', inputDir: pilot },
    { caseId: 'case-public-packaging', language: 'he', inputDir: publicInput },
  ];
  await fs.writeFile(manifestFile, JSON.stringify(rows));
  assert.deepEqual(await buildManifest({ manifestFile }), rows.map(row => ({ ...row, inputDir: path.resolve(row.inputDir) })));
  assert.equal(MAX_MANIFEST_ROWS, 14);
  const seenInputs = [];
  const result = await runWave({ manifestFile, outputFile: checkpoint, getTokenImpl: () => 'token', runCaseImpl: async args => {
    const mode = readOption(args, '--mode');
    seenInputs.push(readOption(args, '--input-dir'));
    if (mode === 'count') {
      await fs.writeFile(readOption(args, '--output'), '{}');
      return { status: 'counted', caseId: readOption(args, '--case-id'), language: readOption(args, '--language'), inputTokens: 1200, outputTokenLimit: 1000 };
    }
    return { status: 'valid', caseId: readOption(args, '--case-id'), language: readOption(args, '--language'), costUsd: 0.03, costUnknown: false };
  } });

  assert.deepEqual(seenInputs, [path.resolve(pilot), path.resolve(publicInput), path.resolve(pilot), path.resolve(publicInput)]);
  assert.deepEqual(result.manifest.map(({ caseId, language }) => [caseId, language]), [
    ['case-568f7d2ab3', 'en'], ['case-public-packaging', 'he'],
  ]);
  assert.equal((await fs.readFile(checkpoint, 'utf8')).includes(publicInput), false);
});

test('all 14 free counts checkpoint before the first inference and preserve each paid result before continuing', async t => {
  const directory = await temporaryDirectory(t);
  const manifestFile = path.join(directory, 'manifest.json');
  const checkpoint = path.join(directory, 'wave.json');
  const caseIds = ['case-568f7d2ab3', 'case-80fd909fc6', 'case-842e0d34ad', 'case-b84442ecb2',
    'case-c2798b8a6b', 'case-f3df5c5c7d', 'case-public-packaging'];
  const manifest = caseIds.flatMap(caseId => ['en', 'he'].map(language => ({ caseId, language, inputDir: directory })));
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  let countCalls = 0;
  let analysisCalls = 0;
  const result = await runWave({ manifestFile, outputFile: checkpoint, getTokenImpl: () => 'token', runCaseImpl: async args => {
    const mode = readOption(args, '--mode');
    const rowIndex = manifest.findIndex(row => row.caseId === readOption(args, '--case-id') && row.language === readOption(args, '--language'));
    if (mode === 'count') {
      countCalls += 1;
      await fs.writeFile(readOption(args, '--output'), '{}');
      return { status: 'counted', caseId: manifest[rowIndex].caseId, language: manifest[rowIndex].language,
        inputTokens: 1200, outputTokenLimit: 5000, sourceCommit: 'reviewed-commit', schemaSha256: 'schema-hash' };
    }
    analysisCalls += 1;
    const saved = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
    assert.equal(saved.countedRows, 14);
    assert.equal(saved.attemptedInferenceCount, analysisCalls);
    if (analysisCalls === 2) {
      assert.equal(saved.results[0].status, 'valid');
      assert.equal(saved.results[0].costUsd, 0.02);
      assert.equal(saved.results[0].costUnknown, false);
    }
    return { status: 'valid', caseId: manifest[rowIndex].caseId, language: manifest[rowIndex].language,
      costUsd: 0.02, costUnknown: false, schemaErrorCount: 0, semanticErrorCount: 0 };
  } });

  assert.equal(countCalls, 14);
  assert.equal(analysisCalls, 14);
  assert.equal(result.countedRows, 14);
  assert.equal(result.attemptedInferenceCount, 14);
  assert.equal(result.status, 'complete');
});

test('a thrown final count failure is marked unbilled and prevents every inference', async t => {
  const directory = await temporaryDirectory(t);
  const manifestFile = path.join(directory, 'manifest.json');
  const checkpoint = path.join(directory, 'wave.json');
  const manifest = ['case-568f7d2ab3', 'case-public-packaging'].map(caseId => ({ caseId, language: 'en', inputDir: directory }));
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  let calls = 0;
  const result = await runWave({ manifestFile, outputFile: checkpoint, getTokenImpl: () => 'token', runCaseImpl: async args => {
    calls += 1;
    if (readOption(args, '--case-id') === 'case-public-packaging') throw new Error('PRIVATE_INPUT_PATH');
    await fs.writeFile(readOption(args, '--output'), '{}');
    return { status: 'counted', caseId: 'case-568f7d2ab3', language: 'en', inputTokens: 1000, outputTokenLimit: 1000 };
  } });

  assert.equal(calls, 2);
  assert.equal(result.attemptedInferenceCount, 0);
  assert.equal(result.stopReason, 'count_failed_before_inference');
  assert.equal(result.results[1].costUnknown, false);
  assert.equal(result.results[1].status, 'count_failed');
  const saved = await fs.readFile(checkpoint, 'utf8');
  assert.equal(saved.includes('PRIVATE_INPUT_PATH'), false);
});

test('pre-inference review callback receives completed count metadata and can stop before billing', async t => {
  const directory = await temporaryDirectory(t);
  const checkpoint = path.join(directory, 'wave.json');
  let inferenceCalls = 0;
  let reviewBoundary;
  const result = await runWave({ inputDir: directory, outputFile: checkpoint, getTokenImpl: () => 'token',
    caseIds: ['case-568f7d2ab3'], languages: ['en', 'he'],
    beforeInference: async boundary => {
      reviewBoundary = boundary;
      throw new Error('review did not release the gate');
    },
    runCaseImpl: async args => {
      if (readOption(args, '--mode') === 'analysis') { inferenceCalls += 1; return { status: 'valid', costUsd: 0.02, costUnknown: false }; }
      await fs.writeFile(readOption(args, '--output'), '{}');
      return { status: 'counted', caseId: readOption(args, '--case-id'), language: readOption(args, '--language'), inputTokens: 900, outputTokenLimit: 1000 };
    } });

  assert.equal(reviewBoundary.phase, 'preflight_complete');
  assert.equal(reviewBoundary.countedRows, 2);
  assert.equal(reviewBoundary.manifestRows, 2);
  assert.equal(inferenceCalls, 0);
  assert.equal(result.attemptedInferenceCount, 0);
  assert.equal(result.stopReason, 'preflight_review_incomplete');
  assert.equal(result.phase, 'stopped');
});

test('compiled grammar errors get a fixed safe reason without retaining provider prose', () => {
  const failure = safeProviderFailure({ status: 400, headers: new Headers() }, {
    message: 'The compiled grammar is too large for this schema. PRIVATE_SCHEMA_DETAIL',
  });
  assert.deepEqual(failure, { category: 'request', status: 400, reason: 'compiled_grammar_too_large' });
  assert.equal(JSON.stringify(failure).includes('PRIVATE_SCHEMA_DETAIL'), false);
});
