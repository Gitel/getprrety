#!/usr/bin/env node
'use strict';

// This utility reads legacy skin-analysis records and exports only minimized quiz data
// plus already-embedded image data URLs; it never writes to MongoDB or fetches photo URLs.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PHOTO_ANGLES = ['front', 'left', 'right', 'closeup', 'neck'];
const QUIZ_FIELDS = [
  'gender', 'identity', 'skin_goals', 'concerns', 'routine_products', 'current_products', 'smoke', 'smokes',
  'health_conditions', 'diabetes', 'has_diabetes', 'allergies', 'pregnant', 'pregnant_or_ttc',
  'pregnancy_caution', 'tone', 'fitzpatrick', 'age', 'age_range', 'event', 'event_type', 'event_date',
  'work_environment', 'post_cleanse_feel', 'irritants', 'diagnosed_conditions', 'interests',
  'sleep', 'stress', 'water_intake', 'alcohol', 'exercise', 'top_concern', 'allergies_other',
  'irritants_other', 'diagnosed_conditions_other',
];
const QUIZ_ARRAY_FIELDS = new Set([
  'skin_goals', 'concerns', 'routine_products', 'current_products', 'health_conditions', 'allergies',
  'irritants', 'diagnosed_conditions', 'interests',
]);
const QUIZ_OTHER_FIELDS = new Set(['allergies_other', 'irritants_other', 'diagnosed_conditions_other']);
const ASSESSMENT_FIELDS = new Set([
  'skin_goals', 'concerns', 'routine_products', 'current_products', 'allergies', 'health_conditions',
  'diagnosed_conditions', 'irritants', 'tone', 'post_cleanse_feel', 'top_concern',
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!['--server-dir', '--output'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Usage: node extract.cjs --server-dir <absolute-server-path> --output <absolute-private-output-path>');
    }
    args[key.slice(2)] = argv[++i];
  }
  if (!args['server-dir'] || !args.output || !path.isAbsolute(args['server-dir']) || !path.isAbsolute(args.output)) {
    throw new Error('Both --server-dir and --output must be absolute paths.');
  }
  return { serverDir: path.resolve(args['server-dir']), outputDir: path.resolve(args.output) };
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pseudonymousCaseId(sourceId) {
  return `case-${crypto.createHash('sha256').update(String(sourceId)).digest('hex').slice(0, 10)}`;
}

function ageAtDate(birthday, date) {
  const match = typeof birthday === 'string' && birthday.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const [, day, month, year] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  let age = date.getUTCFullYear() - year;
  if (date.getUTCMonth() + 1 < month || (date.getUTCMonth() + 1 === month && date.getUTCDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function answerFlag(value) {
  if (value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'yes')) return true;
  if (value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'no')) return false;
  return null;
}

function hasContactDetails(value) {
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)
    || /(?:\+?\d[\d\s().-]{7,}\d)/.test(value);
}

function minimizeQuiz(answers, createdAt) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return {};
  const quiz = {};
  // These fields are used for skin assessment and routine safety; names, contact details,
  // location, consent metadata, and unrestricted free-text answers are deliberately omitted.
  for (const field of QUIZ_FIELDS) {
    const value = answers[field];
    if (QUIZ_ARRAY_FIELDS.has(field)) {
      if (Array.isArray(value)) {
        const safeValues = value.filter((item) => typeof item === 'string' && item.trim()).slice(0, 30)
          .map((item) => item.trim().slice(0, 100));
        if (safeValues.length) quiz[field] = safeValues;
      }
    } else if (QUIZ_OTHER_FIELDS.has(field)) {
      if (typeof value === 'string' && value.trim() && !hasContactDetails(value)) {
        quiz[field] = value.trim().slice(0, 240);
      }
    } else if (typeof value === 'string' && value.trim()) {
      quiz[field] = value.trim().slice(0, field === 'age' ? 20 : 100);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      quiz[field] = value;
    } else if (field === 'pregnancy_caution' && typeof value === 'boolean') {
      quiz[field] = value;
    }
  }
  if (quiz.age === undefined) {
    const derivedAge = ageAtDate(answers.birthday, createdAt);
    if (derivedAge !== null) quiz.age = derivedAge;
  }
  const pregnancyValues = [
    answers.pregnancy_caution,
    answers.pregnant,
    answers.pregnant_or_ttc,
    ...['pregnant', 'trying_to_conceive', 'breastfeeding'].map((key) => answers.hormones?.[key]),
  ];
  const suppliedPregnancyValues = pregnancyValues.filter((value) => value !== undefined && value !== null && value !== '');
  const pregnancyFlags = suppliedPregnancyValues.map(answerFlag);
  if (pregnancyFlags.some((value) => value === true)) quiz.pregnancy_caution = true;
  else if (typeof answers.pregnancy_caution === 'boolean') quiz.pregnancy_caution = answers.pregnancy_caution;
  else if (pregnancyFlags.length && pregnancyFlags.every((value) => value === false)) quiz.pregnancy_caution = false;
  else delete quiz.pregnancy_caution;

  const diabetesFlags = [answerFlag(answers.diabetes), answerFlag(answers.has_diabetes)];
  const healthConditions = Array.isArray(answers.health_conditions) ? answers.health_conditions : [];
  const diabetesInConditions = healthConditions.some((value) => typeof value === 'string' && value.toLowerCase() === 'diabetes');
  if (diabetesFlags.some((value) => value === true) || diabetesInConditions) quiz.diabetes_caution = true;
  else if (diabetesFlags.some((value) => value === false) || healthConditions.length) quiz.diabetes_caution = false;
  return quiz;
}

function parseImageDataUrl(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not_inline_data_url' };
  if (!value.startsWith('data:')) return { ok: false, reason: 'not_inline_data_url' };
  const match = value.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match || match[2].length % 4 !== 0) return { ok: false, reason: 'invalid_or_unsupported_data_url' };
  const mediaType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  const validSignature = mediaType === 'image/jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!validSignature) return { ok: false, reason: 'image_signature_mismatch' };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'image_over_size_limit' };
  return { ok: true, mediaType, bytes };
}

function collectInlineImages(answers) {
  const images = [];
  const rejected = [];
  const candidates = PHOTO_ANGLES.map((angle) => [angle, answers?.[angle]]);
  if (Array.isArray(answers?.shelf_photos)) {
    answers.shelf_photos.forEach((value, index) => candidates.push([`shelf-${String(index + 1).padStart(2, '0')}`, value]));
  }
  for (const [angle, value] of candidates) {
    if (value == null || value === '') continue;
    const parsed = parseImageDataUrl(value);
    if (parsed.ok) images.push({ angle, ...parsed });
    else rejected.push({ angle, reason: parsed.reason });
  }
  return { images, rejected };
}

async function exportCases(records, outputDir) {
  const outputRoot = path.resolve(outputDir);
  const existing = await fs.readdir(outputRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing && existing.length) throw new Error('Output directory must be empty; refusing to overwrite private evaluation data.');
  await fs.mkdir(outputRoot, { recursive: true });

  const inventory = [];
  // Date plus raw database ID makes export order deterministic without exposing that ID.
  const stableRecords = [...records].sort((left, right) => {
    const leftDate = new Date(left.createdAt || 0).getTime();
    const rightDate = new Date(right.createdAt || 0).getTime();
    return leftDate - rightDate || String(left._id).localeCompare(String(right._id));
  });
  for (const record of stableRecords) {
    const { images, rejected } = collectInlineImages(record.quizAnswers);
    const createdAt = record.createdAt instanceof Date ? record.createdAt : new Date(record.createdAt);
    const quiz = minimizeQuiz(record.quizAnswers, createdAt);
    const informativeCount = Object.keys(quiz).filter((key) => key !== 'age' && key !== 'pregnancy_caution').length;
    const assessmentCount = Object.keys(quiz).filter((key) => ASSESSMENT_FIELDS.has(key)).length;
    const id = pseudonymousCaseId(record._id);
    const createdDate = Number.isNaN(createdAt.getTime()) ? null : createdAt.toISOString().slice(0, 10);
    if (informativeCount < 3 || assessmentCount < 2) {
      inventory.push({
        id,
        ...(createdDate ? { createdAt: createdDate } : {}),
        included: false,
        reason: 'insufficient_quiz',
        imageCount: images.length,
        missingInlinePhotos: images.length === 0,
        imageSource: images.length ? 'inline_quiz_data_url' : 'none',
        rejected,
      });
      continue;
    }
    const caseDir = path.join(outputRoot, id);
    await fs.mkdir(caseDir, { recursive: false });
    const imageManifest = [];
    for (const image of images) {
      const extension = image.mediaType === 'image/jpeg' ? 'jpg' : 'png';
      const file = `${image.angle}.${extension}`;
      await fs.writeFile(path.join(caseDir, file), image.bytes, { flag: 'wx', mode: 0o600 });
      imageManifest.push({ angle: image.angle, path: file, mediaType: image.mediaType });
    }
    const hasSkinPhotos = images.some((image) => PHOTO_ANGLES.includes(image.angle));
    const hasShelfPhotos = images.some((image) => image.angle.startsWith('shelf-'));
    // These booleans describe the files actually exported, never historical quiz counters.
    quiz.skinPhotosUploaded = hasSkinPhotos;
    quiz.shelfPhotosUploaded = hasShelfPhotos;
    const caseJson = {
      id,
      source: 'database-test',
      imageSource: images.length ? 'inline_quiz_data_url' : 'none',
      ...(createdDate ? { createdAt: createdDate } : {}),
      quiz,
      images: imageManifest,
    };
    await fs.writeFile(path.join(caseDir, 'case.json'), `${JSON.stringify(caseJson, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    inventory.push({ id, ...(createdDate ? { createdAt: createdDate } : {}), included: true, imageCount: images.length, missingInlinePhotos: images.length === 0, rejected });
  }

  // The inventory has only pseudonymous IDs, inclusion counts, and rejection reasons.
  await fs.writeFile(path.join(outputRoot, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return inventory;
}

async function run() {
  const { serverDir, outputDir } = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..', '..');
  if (isWithin(repoRoot, outputDir)) throw new Error('Private output must be outside the application git worktree.');

  // Load only the explicitly supplied server env and use MongoDB's raw driver; no Mongoose
  // model hooks, app startup, database writes, or network fetches are involved.
  const dotenv = require(path.join(serverDir, 'node_modules', 'dotenv'));
  const serverEnv = dotenv.parse(await fs.readFile(path.join(serverDir, '.env')));
  const { MongoClient } = require(path.join(serverDir, 'node_modules', 'mongodb'));
  const uri = serverEnv.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is missing from the explicitly supplied server .env.');
  const client = new MongoClient(uri, { readPreference: 'secondaryPreferred', appName: 'bedrock-evaluation-readonly-export' });
  try {
    await client.connect();
    const dbName = new URL(uri).pathname.replace(/^\//, '').split('/')[0] || 'getprrety';
    const records = await client.db(dbName).collection('skinanalyses')
      .find({ quizAnswers: { $exists: true, $type: 'object' } }, {
        projection: { _id: 1, quizAnswers: 1, createdAt: 1 },
        maxTimeMS: 15000,
      })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const inventory = await exportCases(records, outputDir);
    const included = inventory.filter((item) => item.included);
    console.log(JSON.stringify({ recordsRead: records.length, exportedCases: included.length, exportedImages: included.reduce((sum, item) => sum + item.imageCount, 0), inventoryPath: path.join(outputDir, 'inventory.json') }));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    // Print only a safe error summary; never emit connection strings, answers, or image data.
    console.error(`Bedrock evaluation export failed (${error.name}).`);
    process.exitCode = 1;
  });
}

module.exports = { ageAtDate, collectInlineImages, exportCases, minimizeQuiz, parseArgs, parseImageDataUrl, pseudonymousCaseId };
