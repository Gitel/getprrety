// Seeds a customer, a SkinAnalysis and a SkinScan (with a written `reading`) straight into the
// IN-MEMORY test database, so the customer-page specs have something to edit.
// Same pattern as support/shopify.js: connect with mongoose to the URI that startServer.js wrote
// to e2e-admin/.tmp/db.json, and use the REAL server models so the saved shapes are valid.
// Nothing here can reach a real database (see the URI guard in withDb).
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The SERVER's node_modules (mongoose); e2e-admin has none of its own.
const serverRequire = createRequire(path.resolve(here, '../../server/package.json'));

// Runs fn(models) against the in-memory DB, then disconnects. Refuses any non-local URI.
async function withDb(fn) {
  const { uri } = JSON.parse(readFileSync(path.join(here, '..', '.tmp', 'db.json'), 'utf8'));
  expect(uri).toMatch(/^mongodb:\/\/(127\.0\.0\.1|localhost)/);
  const mongoose = serverRequire('mongoose');
  await mongoose.connect(uri);
  try {
    return await fn({
      User: serverRequire('./models/User.js'),
      SkinAnalysis: serverRequire('./models/SkinAnalysis.js'),
      SkinScan: serverRequire('./models/SkinScan.js'),
      CatalogueProduct: serverRequire('./models/CatalogueProduct.js'),
      ERAS: serverRequire('./services/eras.js').ERAS,
    });
  } finally {
    await mongoose.disconnect();
  }
}

// A reading in the stored shape (services/skinScan/scoreReading.js sanitizeReading output).
// potential / weeks / shelf / product are NOT editable on the admin page, so the specs check
// they survive an edit untouched.
const buildReading = () => ({
  startHere: { title: 'Start with your barrier', body: 'Your barrier needs calming first.' },
  signals: [
    {
      key: 'barrier', potential: 90, weeks: '6-8 weeks', driver: 'Dry weather', why: 'Your skin loses water fast.',
      lever: 'A richer moisturiser', shelf: { status: 'missing', text: 'No moisturiser on your shelf' }, product: null,
    },
    {
      key: 'clarity', potential: 85, weeks: '4 weeks', driver: 'Congested pores', why: 'Pores look clogged.',
      lever: 'Gentle exfoliation', shelf: null, product: null,
    },
  ],
});

// Quiz answers that make isPregnancyCaution() true AND hasCompleteSafetyContext() true
// (allergies + irritants answered, explicit pregnancy answer), so eligibleProducts() keeps ONLY
// products whose pregnancy field is 'safe'. See server/services/bedrock/analysisContract.js.
export const PREGNANCY_QUIZ = { pregnancy_caution: true, allergies: ['none'], irritants: ['none'] };
// Same completeness but NO restriction: every active home-use product is eligible.
export const OPEN_QUIZ = { pregnancy_caution: false, allergies: ['none'], irritants: ['none'] };

let counter = 0;
// Creates user + scan (with reading) + analysis. Returns { analysisId, scanId, userId, email }.
// Options: quizAnswers (default PREGNANCY_QUIZ), withReading (default true).
export async function seedCustomer({ quizAnswers = PREGNANCY_QUIZ, withReading = true } = {}) {
  const n = `${Date.now()}-${++counter}`;
  return withDb(async ({ User, SkinAnalysis, SkinScan, ERAS }) => {
    const user = await User.create({ email: `seed-${n}@example.test`, firstName: `Seed${counter}`, passwordHash: 'not-a-real-hash' });
    const scan = await SkinScan.create({
      userId: user._id, accessTokenHash: `hash-${n}`, requestIpHash: `ip-${n}`, status: 'complete',
      reading: withReading ? buildReading() : null, readingStatus: withReading ? 'ready' : null,
    });
    const analysis = await SkinAnalysis.create({
      userId: user._id, skinScanId: scan._id, eraId: 'barrier_healing', era: ERAS.barrier_healing, skinAnalysis: 'Seeded analysis text.',
      keyInsights: ['Seeded insight'], quizAnswers,
      safetyFlags: ['Seed flag'], checkInPrompts: ['Seed prompt'],
      srProducts: { bundle_note: 'Seed bundle', era_hero_product: { sr_product_name: 'x', hero_reason: 'y' }, am: [], pm: [] },
    });
    return { analysisId: String(analysis._id), scanId: String(scan._id), userId: String(user._id), email: user.email };
  });
}

// Looks up a seeded catalogue product id by slug (ids are random per run).
export const catalogueIdBySlug = slug => withDb(async ({ CatalogueProduct }) => {
  const p = await CatalogueProduct.findOne({ slug }).select('_id name').lean();
  return p ? { id: String(p._id), name: p.name } : null;
});

// Current stored state, for asserting what was (not) saved.
export const loadStored = analysisId => withDb(async ({ SkinAnalysis, SkinScan }) => {
  const analysis = await SkinAnalysis.findById(analysisId).lean();
  const scan = analysis.skinScanId ? await SkinScan.findById(analysis.skinScanId).lean() : null;
  return { analysis, reading: scan ? scan.reading : null };
});
