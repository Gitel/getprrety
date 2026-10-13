#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { completeJson, reportedCostUsd, TIMEOUT_MS, MAX_OUTPUT_TOKENS, MAX_REPORTED_COST_USD } = require('../../server/services/bedrock/client');
const { outputSchema, buildMessages, validateOutput } = require('../../server/services/bedrock/analysisContract');
const { loadSeedCatalogue: loadCatalogue } = require('../../server/services/bedrock/catalogue');
const { ANALYSIS_SERVER_TIMEOUT_MS, RESPONSE_RESERVE_MS } = require('../../server/services/bedrock/analysisDeadline');
const { readCase } = require('./runner.cjs');
const { parseArgs, isInside, getToken } = require('./run.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PHASES = new Set(['request_start', 'headers', 'first_body', 'first_event', 'first_content', 'last_content', 'body_end', 'validated', 'usage', 'complete', 'timeout', 'cancelled', 'error']);
const COMPACT_INSTRUCTION = 'For this latency comparison only, return at most three distinct key insights. Use at most 12 words per routine instruction and 15 words per insight body. Preserve every required routine category, distinct safety flag, ingredient exclusion and catalogue restriction.';
const AUTHORIZED_CASE_IDS = ['case-568f7d2ab3', 'case-80fd909fc6', 'case-842e0d34ad', 'case-b84442ecb2', 'case-c2798b8a6b', 'case-f3df5c5c7d'];
const ACCEPTANCE_TIMEOUT_MS = ANALYSIS_SERVER_TIMEOUT_MS - RESPONSE_RESERVE_MS;

const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');

// Retain diagnostic timings and counts, never raw provider chunks, quiz fields or exception messages.
function safeEvent(event) {
  if (!PHASES.has(event?.phase)) return null;
  const result = { phase: event.phase };
  for (const field of ['elapsedMs', 'contentBytes', 'costUsd']) {
    if (Number.isFinite(event[field]) && event[field] >= 0) result[field] = event[field];
  }
  const httpStatus = event.httpStatus ?? event.status;
  if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) result.httpStatus = httpStatus;
  if (['stop', 'completed', 'length'].includes(event.finishReason)) result.finishReason = event.finishReason;
  if (typeof event.providerRequestId === 'string' && /^[\w-]{1,128}$/.test(event.providerRequestId)) result.providerRequestId = event.providerRequestId;
  return result;
}

// Each labelled configuration gets one call. Unknown or excessive charges stop the next paid request.
async function runInvestigation({ tasks, catalogue, token, metadata = {}, completeImpl = completeJson, validateImpl = validateOutput, onResult = () => {}, onCheckpoint = async () => {} }) {
  const report = { generatedAt: new Date().toISOString(), automaticRetries: 0, tier: 'default', reasoningEffort: 'low', maxCompletionTokens: MAX_OUTPUT_TOKENS, maxReportedCostUsd: MAX_REPORTED_COST_USD, schemaSha256: fingerprint(JSON.stringify(outputSchema)), ...metadata, results: [], knownCostUsd: 0, stopReason: null };
  await onCheckpoint(report);
  for (const task of tasks) {
    const built = buildMessages({ quiz: task.testCase.quiz, language: task.language, images: task.testCase.images, catalogue });
    if (task.compact) built.system += `\n${COMPACT_INSTRUCTION}`;
    const result = { label: task.label, caseId: task.testCase.caseId, language: task.language, imageCount: task.testCase.images.length, stream: task.stream, compact: Boolean(task.compact), timeoutMs: task.timeoutMs, promptSha256: fingerprint(JSON.stringify(built)), events: [], valid: false, costUsd: null, costUnknown: true };
    const started = performance.now();
    result.status = 'in_flight';
    report.results.push(result);
    report.inFlightResult = { label: result.label, caseId: result.caseId, language: result.language, status: result.status, costUnknown: true };
    await onCheckpoint(report);
    try {
      const output = await completeImpl({ ...built, schema: outputSchema, token, stream: task.stream, timeoutMs: task.timeoutMs,
        onEvent(event) {
          const safe = safeEvent(event);
          if (safe) result.events.push(safe);
          if (event?.usage) {
            result.costUsd = reportedCostUsd(event.usage);
            result.costUnknown = result.costUsd === null;
            if (!result.costUnknown) result.usage = {
              promptTokens: event.usage.prompt_tokens, completionTokens: event.usage.completion_tokens,
              cachedTokens: event.usage.prompt_tokens_details?.cached_tokens ?? 0,
              reasoningTokens: Number.isSafeInteger(event.usage.completion_tokens_details?.reasoning_tokens) ? event.usage.completion_tokens_details.reasoning_tokens : null,
            };
          }
        },
      });
      const validation = validateImpl(output, { quiz: task.testCase.quiz, language: task.language, images: task.testCase.images }, catalogue);
      result.semanticErrorCount = validation.errors.length;
      result.outputBytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
      result.valid = validation.errors.length === 0 && !result.costUnknown && result.costUsd <= MAX_REPORTED_COST_USD;
      result.status = result.valid ? 'valid' : 'invalid';
    } catch (error) {
      result.status = /^BEDROCK_[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'REQUEST_FAILED';
    }
    result.totalMs = Math.round(performance.now() - started);
    report.knownCostUsd += result.costUsd ?? 0;
    delete report.inFlightResult;
    onResult({ label: result.label, caseId: result.caseId, language: result.language, status: result.status, valid: result.valid, totalMs: result.totalMs, costUsd: result.costUsd });
    if (result.costUnknown || result.costUsd > MAX_REPORTED_COST_USD || report.knownCostUsd >= 3) {
      report.stopReason = result.costUnknown ? 'unknown provider cost' : 'observed cost ceiling reached';
      await onCheckpoint(report);
      break;
    }
    await onCheckpoint(report);
  }
  return report;
}

// Replace the last valid report only after a same-directory checkpoint is fully written and synced.
async function writeAtomicCheckpoint(outputFile, report) {
  const absoluteOutput = path.resolve(outputFile);
  const reportDirectory = path.dirname(absoluteOutput);
  const temporaryFile = path.join(reportDirectory, `.${path.basename(absoluteOutput)}.${crypto.randomUUID()}.tmp`);
  let temporaryHandle;
  let renamed = false;
  try {
    temporaryHandle = await fs.open(temporaryFile, 'wx');
    await temporaryHandle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    await fs.rename(temporaryFile, absoluteOutput);
    renamed = true;
  } finally {
    if (temporaryHandle) await temporaryHandle.close().catch(() => {});
    const isOwnedSibling = path.dirname(path.resolve(temporaryFile)) === reportDirectory
      && path.basename(temporaryFile).startsWith(`.${path.basename(absoluteOutput)}.`);
    if (!renamed && isOwnedSibling) await fs.unlink(temporaryFile).catch(() => {});
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options['input-dir'] || !options.output || !['diagnostics', 'acceptance'].includes(options.mode || 'diagnostics')) throw new Error('Required: --input-dir DIR --output FILE --mode diagnostics|acceptance [--server-dir DIR]');
  const inputDirectory = path.resolve(options['input-dir']);
  const outputFile = path.resolve(options.output);
  if (isInside(REPO_ROOT, inputDirectory) || isInside(REPO_ROOT, outputFile)) throw new Error('Input and output must be outside the application worktree');
  const entries = (await fs.readdir(inputDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.startsWith('case-')).map(entry => entry.name).sort();
  assertAuthorizedCaseFolders(entries);
  const cases = [];
  for (const caseId of AUTHORIZED_CASE_IDS) {
    const testCase = await readCase(path.join(inputDirectory, caseId));
    if (testCase.caseId !== caseId) throw new Error(`Case folder ID does not match its case record: ${caseId}`);
    cases.push(testCase);
  }
  const mode = options.mode || 'diagnostics';
  const tasks = mode === 'diagnostics'
      ? [
        { label: 'nonstream-control', stream: false },
        { label: 'stream-comparison', stream: true },
        { label: 'compact-stream-comparison', stream: true, compact: true },
      ].map(task => ({ ...task, testCase: cases[0], language: 'en', timeoutMs: TIMEOUT_MS }))
      // Reserve server setup and response time within the user-selected 90-second client deadline.
      : cases.flatMap(testCase => ['en', 'he'].map(language => ({ label: 'final-contract-acceptance', stream: true, testCase, language, timeoutMs: ACCEPTANCE_TIMEOUT_MS })));
  const metadata = {
    mode,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    expectedResultCount: tasks.length,
    acceptanceProviderTimeoutMs: mode === 'acceptance' ? ACCEPTANCE_TIMEOUT_MS : null,
  };
  // Create each evidence file exclusively and checkpoint before any provider request.
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  // The empty exclusive placeholder prevents reuse of a prior output path; close it before atomic replacement on Windows.
  const destination = await fs.open(outputFile, 'wx');
  await destination.close();
  const checkpoint = report => writeAtomicCheckpoint(outputFile, report);
  const report = await runInvestigation({ tasks, catalogue: loadCatalogue(), token: getToken(options['server-dir']), metadata, onCheckpoint: checkpoint,
    onResult: result => process.stdout.write(`${JSON.stringify(result)}\n`) });
  report.complete = !report.stopReason && report.results.length === tasks.length;
  await checkpoint(report);
  process.exitCode = report.complete && report.results.every(result => result.valid) ? 0 : 1;
}

function assertAuthorizedCaseFolders(folderIds) {
  const actual = [...folderIds].sort();
  const expected = [...AUTHORIZED_CASE_IDS].sort();
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error('Input must contain exactly the six authorized case folders');
  }
}

if (require.main === module) main().catch(() => { process.stderr.write('Investigation could not complete; credentials and private inputs are omitted.\n'); process.exitCode = 1; });
module.exports = { AUTHORIZED_CASE_IDS, ACCEPTANCE_TIMEOUT_MS, assertAuthorizedCaseFolders, safeEvent, runInvestigation, writeAtomicCheckpoint, main };
