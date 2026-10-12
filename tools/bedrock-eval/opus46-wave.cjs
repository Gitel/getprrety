#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { main: runCase, DEFAULT_CASE_ID, INPUT_COUNT_ALLOWANCE_TOKENS, RESERVED_COST_USD } = require('./opus46.cjs');
const { parseArgs, isInside, getToken } = require('./run.cjs');
const { writeAtomicCheckpoint } = require('./investigate.cjs');

const ROOT = path.resolve(__dirname, '../..');
// These are the six saved evaluation fixtures already used by the diagnostics workflow.
const CASE_IDS = Object.freeze([
  DEFAULT_CASE_ID,
  'case-80fd909fc6',
  'case-842e0d34ad',
  'case-b84442ecb2',
  'case-c2798b8a6b',
  'case-f3df5c5c7d',
]);
const LANGUAGES = Object.freeze(['en', 'he']);
const CASE_LIMIT_USD = 0.25;
const WAVE_LIMIT_USD = 3.5;
const MAX_MANIFEST_ROWS = 14;
const MANIFEST_CASE_IDS = new Set([...CASE_IDS, 'case-public-packaging']);

function safeResult(report) {
  // Retain evaluation metrics only; never copy prompts, model output, or quiz fields into the wave log.
  const fields = ['caseId', 'language', 'imageCount', 'status', 'failureCategory', 'failureReason', 'httpStatus',
    'inputTokens', 'outputTokenLimit', 'usage', 'estimatedInputCostUsd', 'costUsd', 'costUnknown', 'schemaErrorCount',
    'semanticErrorCount', 'semanticErrorCategories', 'qualityMetrics', 'outputBytes', 'elapsedMs', 'totalMs', 'providerRequestId',
    'sourceCommit', 'promptSha256', 'productionPromptSha256', 'schemaSha256', 'wireSchemaSha256', 'countMethod',
    'schemaAwareCount', 'inputCountAllowanceTokens', 'bufferedInputCostUsd', 'reservedCostUsd', 'costGate'];
  return Object.fromEntries(fields.filter(key => report[key] !== undefined).map(key => [key, report[key]]));
}

function stopAfterAnalysis(report, accumulatedCost) {
  if (report.costUnknown || report.costUsd == null) return 'unknown_cost';
  if (report.costUsd > CASE_LIMIT_USD) return 'case_cost_ceiling';
  if (accumulatedCost > WAVE_LIMIT_USD) return 'wave_cost_ceiling';
  if (report.failureCategory && report.failureCategory !== 'validation') return report.failureCategory;
  return null;
}

async function buildManifest({ manifestFile, inputDir, caseIds, languages }) {
  if (manifestFile) {
    const manifestPath = path.resolve(manifestFile);
    if (isInside(ROOT, manifestPath)) throw new Error('manifest must be outside the application worktree');
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > MAX_MANIFEST_ROWS) throw new Error(`manifest must contain 1 to ${MAX_MANIFEST_ROWS} rows`);
    const seen = new Set();
    const tasks = [];
    for (const row of parsed) {
      if (!row || !MANIFEST_CASE_IDS.has(row.caseId) || !['en', 'he'].includes(row.language) || typeof row.inputDir !== 'string') {
        throw new Error('manifest row is invalid');
      }
      const key = `${row.caseId}:${row.language}`;
      if (seen.has(key)) throw new Error('manifest rows must have unique case/language pairs');
      seen.add(key);
      const directory = path.resolve(row.inputDir);
      if (isInside(ROOT, directory)) throw new Error('manifest input folders must be outside the application worktree');
      tasks.push({ caseId: row.caseId, language: row.language, inputDir: directory });
    }
    return tasks;
  }
  if (!inputDir) throw new Error('required: --input-dir DIR when --manifest is not supplied');
  const directory = path.resolve(inputDir);
  if (isInside(ROOT, directory)) throw new Error('input directory must be outside the application worktree');
  if (!Array.isArray(caseIds) || !caseIds.length || caseIds.some(id => !MANIFEST_CASE_IDS.has(id))) throw new Error('wave case manifest is invalid');
  if (!Array.isArray(languages) || !languages.length || languages.some(language => !['en', 'he'].includes(language))) throw new Error('wave language manifest is invalid');
  return caseIds.flatMap(caseId => languages.map(language => ({ caseId, language, inputDir: directory })));
}

function safeThrownCategory(error, fallback) {
  const allowed = new Set(['access', 'model', 'schema', 'throttled', 'service', 'request', 'timeout', 'count', 'budget', 'cost', 'response', 'validation']);
  return allowed.has(error?.category) ? error.category : fallback;
}

async function runWave({ inputDir, manifestFile, outputFile, serverDir, getTokenImpl = getToken, fetchImpl = fetch, runCaseImpl = runCase,
  beforeInference = async () => {}, caseIds = CASE_IDS, languages = LANGUAGES }) {
  const checkpointFile = path.resolve(outputFile);
  if (!outputFile) throw new Error('required: --output FILE');
  if (isInside(ROOT, checkpointFile)) throw new Error('output must be outside the application worktree');
  const tasks = await buildManifest({ manifestFile, inputDir, caseIds, languages });
  const token = getTokenImpl(serverDir);
  const outputDirectory = path.dirname(checkpointFile);
  await fs.mkdir(outputDirectory, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(), model: 'us.anthropic.claude-opus-4-6-v1', region: 'us-east-1',
    timeoutMs: 90_000, automaticRetries: 0, tier: 'default', caseLimitUsd: CASE_LIMIT_USD, waveLimitUsd: WAVE_LIMIT_USD,
    inputCountAllowanceTokens: INPUT_COUNT_ALLOWANCE_TOKENS, outputReserveUsd: RESERVED_COST_USD,
    costGate: 'estimate_not_guarantee_with_count_allowance_and_output_reserve', phase: 'counting',
    manifest: tasks.map(({ caseId, language }) => ({ caseId, language })),
    results: tasks.map(({ caseId, language }) => ({ caseId, language, status: 'queued', countStatus: 'pending', analysisAttempted: false, costUsd: null, costUnknown: false })),
    countedRows: 0, attemptedInferenceCount: 0, observedCostUsd: 0, reservedCostUsd: 0, status: 'in_progress', stopReason: null,
  };
  // Hash the normalized source folders too, while keeping their absolute paths out of the result report.
  report.manifestSha256 = crypto.createHash('sha256').update(JSON.stringify(tasks)).digest('hex');
  const placeholder = await fs.open(checkpointFile, 'wx');
  await placeholder.close();
  await writeAtomicCheckpoint(checkpointFile, report);

  const countFiles = [];
  for (const [index, item] of report.manifest.entries()) {
    const task = tasks[index];
    const row = report.results[index];
    row.status = 'count_in_flight';
    row.countStatus = 'in_flight';
    await writeAtomicCheckpoint(checkpointFile, report);
    const stem = `${String(index + 1).padStart(2, '0')}-${item.caseId}-${item.language}`;
    const countFile = path.join(outputDirectory, `${stem}.count.json`);
    countFiles[index] = countFile;
    const priorExitCode = process.exitCode;
    let counted;
    try {
      counted = await runCaseImpl(['--mode', 'count', '--input-dir', task.inputDir, '--output', countFile,
        '--case-id', item.caseId, '--language', item.language], { getToken: () => token, fetchImpl });
    } catch (error) {
      row.status = 'count_failed';
      row.countStatus = 'failed';
      row.failureCategory = safeThrownCategory(error, 'count_setup');
      report.stopReason = 'count_failed_before_inference';
    } finally {
      process.exitCode = priorExitCode;
    }
    if (report.stopReason) {
      await writeAtomicCheckpoint(checkpointFile, report);
      break;
    }
    Object.assign(row, safeResult(counted));
    if (counted.status !== 'counted') {
      row.status = 'count_failed';
      row.countStatus = 'failed';
      row.costUnknown = false;
      report.stopReason = counted.failureCategory || 'count_failed';
      await writeAtomicCheckpoint(checkpointFile, report);
      break;
    }
    row.status = 'counted';
    row.countStatus = 'counted';
    row.costUnknown = false;
    report.countedRows += 1;
    for (const field of ['sourceCommit', 'schemaSha256', 'countMethod', 'schemaAwareCount', 'inputCountAllowanceTokens', 'costGate']) {
      if (counted[field] !== undefined) report[field] = counted[field];
    }
    await writeAtomicCheckpoint(checkpointFile, report);
  }

  // Complete every free count and durably mark the reviewed boundary before any paid inference can start.
  if (!report.stopReason) {
    report.phase = 'preflight_complete';
    await writeAtomicCheckpoint(checkpointFile, report);
    try {
      await beforeInference({ phase: report.phase, manifestSha256: report.manifestSha256, countedRows: report.countedRows,
        manifestRows: report.manifest.length, sourceCommit: report.sourceCommit || null, schemaSha256: report.schemaSha256 || null,
        countMethod: report.countMethod || null, costGate: report.costGate });
      report.phase = 'inference';
      await writeAtomicCheckpoint(checkpointFile, report);
    } catch {
      report.stopReason = 'preflight_review_incomplete';
    }
  }
  for (const [index, item] of report.manifest.entries()) {
    if (report.stopReason) break;
    const task = tasks[index];
    const row = report.results[index];
    const stem = `${String(index + 1).padStart(2, '0')}-${item.caseId}-${item.language}`;
    const analysisFile = path.join(outputDirectory, `${stem}.analysis.json`);
    row.status = 'in_flight';
    row.analysisAttempted = true;
    row.costUnknown = true;
    report.attemptedInferenceCount += 1;
    report.reservedCostUsd += CASE_LIMIT_USD;
    await writeAtomicCheckpoint(checkpointFile, report);
    const priorExitCode = process.exitCode;
    let analyzed;
    try {
      analyzed = await runCaseImpl(['--mode', 'analysis', '--input-dir', task.inputDir, '--output', analysisFile,
        '--count-report', countFiles[index], '--case-id', item.caseId, '--language', item.language], { getToken: () => token, fetchImpl });
    } catch (error) {
      analyzed = { status: 'failed', caseId: item.caseId, language: item.language, costUsd: null, costUnknown: true,
        failureCategory: safeThrownCategory(error, 'setup_or_inference_unknown') };
    } finally {
      process.exitCode = priorExitCode;
    }
    Object.assign(row, safeResult(analyzed));
    report.observedCostUsd += analyzed.costUsd || 0;
    report.reservedCostUsd -= CASE_LIMIT_USD;
    const stopReason = stopAfterAnalysis(analyzed, report.observedCostUsd);
    row.status = analyzed.status;
    report.phase = 'inference';
    await writeAtomicCheckpoint(checkpointFile, report);
    if (stopReason) {
      report.stopReason = stopReason;
      break;
    }
  }
  report.phase = report.stopReason ? 'stopped' : 'terminal';
  report.status = report.stopReason ? 'stopped' : 'complete';
  report.completedAt = new Date().toISOString();
  await writeAtomicCheckpoint(checkpointFile, report);
  return report;
}

async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write('Usage: node opus46-wave.cjs --input-dir DIR --output FILE [--server-dir DIR] | --manifest FILE --output FILE [--server-dir DIR]\n');
    return 0;
  }
  const report = await runWave({ inputDir: options['input-dir'], manifestFile: options.manifest, outputFile: options.output, serverDir: options['server-dir'] });
  process.stdout.write(`${JSON.stringify({ output: path.resolve(options.output), status: report.status, observedCostUsd: report.observedCostUsd,
    stopReason: report.stopReason, completedResults: report.results.length })}\n`);
  return report.status === 'complete' ? 0 : 1;
}

if (require.main === module) runCli().then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('Opus evaluation wave setup failed; private inputs and credentials are omitted.\n');
  process.exitCode = 1;
});

module.exports = { CASE_IDS, LANGUAGES, CASE_LIMIT_USD, WAVE_LIMIT_USD, MAX_MANIFEST_ROWS, safeResult, stopAfterAnalysis, buildManifest, runWave, runCli };
