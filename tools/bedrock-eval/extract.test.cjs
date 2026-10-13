'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ageAtDate,
  collectInlineImages,
  exportCases,
  minimizeQuiz,
  parseImageDataUrl,
  pseudonymousCaseId,
} = require('./extract.cjs');

const date = new Date('2026-10-08T00:00:00.000Z');
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const jpegDataUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;

test('age is calculated at the historical analysis date and rejects malformed birthdays', () => {
  assert.equal(ageAtDate('08/10/2000', date), 26);
  assert.equal(ageAtDate('09/10/2000', date), 25);
  assert.equal(ageAtDate('31/02/2000', date), null);
  assert.equal(ageAtDate('not a birthday', date), null);
});

test('quiz minimization retains allowed fields and drops identifying or unrestricted answers', () => {
  const quiz = minimizeQuiz({
    name: 'Private Name', email: 'person@example.test', phone: '+100000000',
    city: 'Private City', birthday: '08/10/2000', gender: 'they',
    skin_goals: ['acne'], allergies: ['fragrance'],
    hormones: { pregnant: 'no', trying_to_conceive: 'no', breastfeeding: 'no' },
    allergies_other: 'free text that could identify someone',
  }, date);
  assert.deepEqual(quiz, {
    gender: 'they', skin_goals: ['acne'], allergies: ['fragrance'], age: 26,
    allergies_other: 'free text that could identify someone', pregnancy_caution: false,
  });
  assert.equal(Object.hasOwn(quiz, 'birthday'), false);
  assert.equal(Object.hasOwn(quiz, 'email'), false);
  assert.equal(Object.hasOwn(minimizeQuiz({ allergies_other: 'Contact me at person@example.test' }, date), 'allergies_other'), false);
  assert.deepEqual(minimizeQuiz({ skin_goals: [{ email: 'private@example.test' }, 'dryness'] }, date), {
    skin_goals: ['dryness'],
  });
});

test('missing pregnancy answers remain missing; an explicit positive is normalized', () => {
  assert.deepEqual(minimizeQuiz({ hormones: { pregnant: 'not_answered' } }, date), {});
  assert.deepEqual(minimizeQuiz({ hormones: { breastfeeding: 'yes' } }, date), { pregnancy_caution: true });
  assert.equal(minimizeQuiz({ pregnant: 'no' }, date).pregnancy_caution, undefined);
  assert.equal(minimizeQuiz({ pregnant: 'no', hormones: { pregnant: 'no', trying_to_conceive: 'no', breastfeeding: 'no' } }, date).pregnancy_caution, false);
  assert.equal(minimizeQuiz({ pregnant_or_ttc: 'no' }, date).pregnancy_caution, false);
  assert.equal(minimizeQuiz({ pregnant: 'no', pregnant_or_ttc: 'yes' }, date).pregnancy_caution, true);
  assert.equal(minimizeQuiz({ pregnant_or_ttc: 'yes', hormones: { pregnant: 'no', trying_to_conceive: 'no', breastfeeding: 'no' } }, date).pregnancy_caution, true);
  assert.equal(minimizeQuiz({ pregnancy_caution: true, hormones: { pregnant: 'no', trying_to_conceive: 'no', breastfeeding: 'no' } }, date).pregnancy_caution, true);
  assert.equal(minimizeQuiz({ pregnant: 'unanswered' }, date).pregnancy_caution, undefined);
  assert.equal(minimizeQuiz({ pregnant: 'no', hormones: { pregnant: 'no', trying_to_conceive: 'unknown' } }, date).pregnancy_caution, undefined);
});

test('legacy answer names, existing age, numeric stress, and safety normalization survive minimization', () => {
  assert.deepEqual(minimizeQuiz({
    name: 'Private Name', concerns: ['breakouts'], age: '25-34', smoke: 'daily', event: 'wedding',
    diabetes: 'yes', pregnant: 'no', stress: 4, allergies_other: 'fragrance sensitivity',
    diagnosed_conditions_other: 'eczema',
  }, date), {
    concerns: ['breakouts'], smoke: 'daily', diabetes: 'yes', pregnant: 'no', event: 'wedding',
    stress: 4, age: '25-34', allergies_other: 'fragrance sensitivity',
    diagnosed_conditions_other: 'eczema', diabetes_caution: true,
  });
  assert.equal(minimizeQuiz({ pregnant: 'yes', hormones: { pregnant: 'no', trying_to_conceive: 'no', breastfeeding: 'no' } }, date).pregnancy_caution, true);
  assert.equal(minimizeQuiz({ has_diabetes: 'no', health_conditions: ['diabetes'] }, date).diabetes_caution, true);
  assert.deepEqual(minimizeQuiz({ gender: 'she' }, date), { gender: 'she' });
});

test('only valid inline JPEG and PNG data URLs are accepted; remote/local paths are never fetched', () => {
  const valid = parseImageDataUrl(jpegDataUrl);
  assert.equal(valid.ok, true);
  assert.equal(valid.mediaType, 'image/jpeg');
  assert.deepEqual(valid.bytes, jpegBytes);
  assert.equal(parseImageDataUrl('https://example.test/photo.jpg').ok, false);
  assert.equal(parseImageDataUrl('file:///private/photo.jpg').ok, false);
  assert.equal(parseImageDataUrl(`data:image/png;base64,${jpegBytes.toString('base64')}`).reason, 'image_signature_mismatch');
  const collected = collectInlineImages({ front: jpegDataUrl, right: 'https://example.test/right.jpg' });
  assert.deepEqual(collected.images.map((image) => image.angle), ['front']);
  assert.deepEqual(collected.rejected, [{ angle: 'right', reason: 'not_inline_data_url' }]);
});

test('case IDs are stable hashes and the export writes only minimized metadata plus linked inline photos', async () => {
  const firstId = pseudonymousCaseId('raw-database-id');
  assert.equal(firstId, pseudonymousCaseId('raw-database-id'));
  assert.match(firstId, /^case-[a-f0-9]{10}$/);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bedrock-export-test-'));
  try {
    const inventory = await exportCases([{
      _id: 'raw-database-id',
      createdAt: date,
      quizAnswers: { name: 'Private Name', email: 'private@example.test', birthday: '08/10/2000', front: jpegDataUrl, skin_goals: ['acne'], routine_products: ['cleanser'], gender: 'they' },
    }, {
      _id: 'text-only-database-id',
      createdAt: date,
      quizAnswers: { gender: 'they', skin_goals: ['dryness'], tone: 'III', skin_photos_uploaded: true },
    }, {
      _id: 'insufficient-database-id',
      createdAt: date,
      quizAnswers: { gender: 'they', name: 'Private Name' },
    }], tempDir);
    assert.deepEqual(inventory.map(({ id, createdAt, included, imageCount, missingInlinePhotos }) => ({ id, createdAt, included, imageCount, missingInlinePhotos })), [
      { id: pseudonymousCaseId('insufficient-database-id'), createdAt: '2026-10-08', included: false, imageCount: 0, missingInlinePhotos: true },
      { id: firstId, createdAt: '2026-10-08', included: true, imageCount: 1, missingInlinePhotos: false },
      { id: pseudonymousCaseId('text-only-database-id'), createdAt: '2026-10-08', included: true, imageCount: 0, missingInlinePhotos: true },
    ]);
    const caseDir = path.join(tempDir, firstId);
    const manifestText = await fs.readFile(path.join(caseDir, 'case.json'), 'utf8');
    assert.equal(manifestText.includes('Private Name'), false);
    assert.equal(manifestText.includes('private@example.test'), false);
    assert.deepEqual(await fs.readFile(path.join(caseDir, 'front.jpg')), jpegBytes);
    assert.equal((await fs.stat(path.join(caseDir, 'front.jpg'))).isFile(), true);

    const textOnly = await fs.readFile(path.join(tempDir, pseudonymousCaseId('text-only-database-id'), 'case.json'), 'utf8');
    const textCase = JSON.parse(textOnly);
    assert.deepEqual(textCase.images, []);
    assert.equal(textCase.imageSource, 'none');
    assert.equal(textCase.quiz.skinPhotosUploaded, false);
    assert.equal(textCase.quiz.shelfPhotosUploaded, false);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
