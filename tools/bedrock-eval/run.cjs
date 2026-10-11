#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { readCase, readCatalogue, runEvaluations } = require('./runner.cjs');
const contract = require('./contract.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_CATALOGUE = path.join(REPO_ROOT, 'server/data/catalogue-seed/products.json');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'help') { options.help = true; continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function numberOption(options, key, fallback, minimum, maximum = Number.POSITIVE_INFINITY) {
  const value = options[key] == null ? fallback : Number(options[key]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`--${key} must be a number between ${minimum} and ${maximum}`);
  }
  return value;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// A stopped run is incomplete even when every result collected before the stop was valid.
function isSuccessfulReport(report, expectedResultCount) {
  return !report.stopReason
    && report.results.length === expectedResultCount
    && report.results.every(result => result.valid && result.withinAnalysisCostCeiling === true);
}

// An explicit server folder avoids loading a different project's .env by accident.
function getToken(serverDirectory) {
  if (process.env.AWS_BEARER_TOKEN_BEDROCK) return process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!serverDirectory) throw new Error('Set AWS_BEARER_TOKEN_BEDROCK or pass --server-dir with the existing server folder');
  const absoluteDirectory = path.resolve(serverDirectory);
  const dotenvPath = path.join(absoluteDirectory, 'node_modules', 'dotenv');
  const dotenv = require(dotenvPath);
  dotenv.config({ path: path.join(absoluteDirectory, '.env'), quiet: true });
  if (!process.env.AWS_BEARER_TOKEN_BEDROCK) throw new Error('AWS_BEARER_TOKEN_BEDROCK was not present in the selected environment or server .env');
  return process.env.AWS_BEARER_TOKEN_BEDROCK;
}

async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write('Usage: node run.cjs --input-dir DIR --output FILE [--catalogue FILE] [--server-dir DIR] [--max-cases N] [--languages en,he] [--max-run-cost USD] [--max-attempts 1|2]\n');
    return 0;
  }
  for (const required of ['input-dir', 'output']) {
    if (!options[required]) throw new Error(`--${required} is required`);
  }
  const outputFile = path.resolve(options.output);
  if (isInside(REPO_ROOT, outputFile)) throw new Error('--output must be outside the evaluation git worktree');

  const inputDirectory = path.resolve(options['input-dir']);
  const catalogueFile = path.resolve(options.catalogue || DEFAULT_CATALOGUE);
  if (isInside(REPO_ROOT, inputDirectory)) throw new Error('--input-dir must be outside the evaluation git worktree');
  const maxCases = numberOption(options, 'max-cases', 6, 1);
  const maxRunCostUsd = numberOption(options, 'max-run-cost', 3, 0.01);
  const maxAnalysisCostUsd = numberOption(options, 'max-analysis-cost', 0.25, 0.01, 0.25);
  const maxAttempts = numberOption(options, 'max-attempts', 1, 1);
  if (!Number.isInteger(maxAttempts) || maxAttempts > 2) throw new Error('--max-attempts must be either 1 or 2');
  const languages = String(options.languages || 'en,he').split(',').map(value => value.trim()).filter(Boolean);
  if (!languages.length || languages.some(language => !['en', 'he'].includes(language))) {
    throw new Error('--languages must be a comma-separated list containing only en and/or he');
  }
  const token = getToken(options['server-dir']);
  const entries = (await fs.readdir(inputDirectory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('case-'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, maxCases);
  if (!entries.length) throw new Error(`no case-* folders found under ${inputDirectory}`);

  const cases = [];
  for (const entry of entries) cases.push(await readCase(path.join(inputDirectory, entry.name)));
  const catalogue = await readCatalogue(catalogueFile);
  const report = await runEvaluations({
    cases,
    languages,
    catalogue,
    contract,
    token,
    maxRunCostUsd,
    maxAnalysisCostUsd,
    maxAttempts,
    onAttempt: progress => process.stdout.write(`${JSON.stringify({ type: 'attempt', ...progress })}\n`),
  });
  report.generatedAt = new Date().toISOString();
  report.caseCount = cases.length;
  report.languages = languages;
  report.resultCount = report.results.length;
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

  const summary = report.results.map(result => ({
    caseId: result.caseId,
    language: result.language,
    status: result.status,
    valid: result.valid,
    latencyMs: result.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
    costUsd: result.costUsd,
    withinAnalysisCostCeiling: result.withinAnalysisCostCeiling,
  }));
  process.stdout.write(`${JSON.stringify({ output: outputFile, totalCostUsd: report.totalCostUsd, stopReason: report.stopReason, results: summary })}\n`);
  const expectedResultCount = cases.length * languages.length;
  return isSuccessfulReport(report, expectedResultCount) ? 0 : 1;
}

if (require.main === module) {
  runCli().then(code => { process.exitCode = code; }).catch(error => {
    // CLI errors contain paths/argument names only; credentials and case contents are never printed.
    process.stderr.write(`${String(error?.message || error).slice(0, 500)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, numberOption, isInside, isSuccessfulReport, getToken, runCli };
