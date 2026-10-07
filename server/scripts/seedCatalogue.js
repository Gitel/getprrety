#!/usr/bin/env node

// Seeds the SR catalogue (collection "catalogueproducts") from server/data/catalogue-seed/.
//
// WARNING: this script WRITES to the database (insert-only). It is run by the user, by hand,
// after a deploy - it is never run automatically:
//
//   cd server
//   npm run seed:catalogue -- --dry-run     (preview: connects and reads, writes no documents)
//   npm run seed:catalogue                  (real run)
//
// Note: even a dry run writes no DOCUMENTS, but Mongoose may create the empty collection and
// its indexes when it connects (autoCreate / autoIndex are on by default).
//
// Insert-only: each seed product carries a hidden permanent seedKey (= its slug in
// products.json). A product is inserted only when NO document has that seedKey. The admin
// can rename a product (its slug then changes) but never its seedKey, so a re-run does not
// re-add a renamed product. If a seed product's slug or name is already used by a document
// with a different / missing seedKey (e.g. an admin created or renamed a product to that
// name), it is SKIPPED with a warning. Nothing is ever updated or deleted, so re-running is
// safe and keeps any edits the admin made in /admin/catalogue.
//
// Needs MONGODB_URI in server/.env (or in the environment). The URI is never printed.
// The last stdout line is "Inserted <n>, skipped <m> (already present)." (or "Would insert
// <n>, skip <m> (already present)." with --dry-run). Exit code 0 = ok, 1 = any error.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const CatalogueProduct = require('../models/CatalogueProduct');
const { slugify, MAX_PHOTO_BYTES } = require('../services/catalogueProducts');
const { detectImageType } = require('../services/imageType');

// Always the folder next to this script's parent; not a CLI option on purpose.
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../data/catalogue-seed');

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const isStringArray = v => Array.isArray(v) && v.every(item => typeof item === 'string');

// Reads and validates products.json + the photos it references. Touches NO database.
// Returns { products, problems }: products are ready for insertMany (photo already loaded
// as { data, mimeType, size }); when problems is not empty nothing must be written.
function loadSeed(dataDir = DEFAULT_DATA_DIR) {
  const problems = [];
  const products = [];
  const file = path.join(dataDir, 'products.json');

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { products, problems: [`Cannot read ${file}: ${err.message}`] };
  }
  if (!parsed || !Array.isArray(parsed.products)) {
    return { products, problems: ['products.json must look like { "products": [ ... ] }'] };
  }

  const seenSlugs = new Set();
  const seenNames = new Set();
  const photosDir = path.join(dataDir, 'photos');

  parsed.products.forEach((raw, index) => {
    const p = raw || {};
    const label = `product #${index + 1} (${p.slug || p.name || '?'})`;
    const bad = msg => problems.push(`${label}: ${msg}`);

    if (typeof p.name !== 'string' || !p.name.trim()) bad('name is required');
    // The seed slug (which also becomes the permanent seedKey) must be exactly what the admin service would derive.
    if (typeof p.name === 'string' && p.slug !== slugify(p.name)) bad(`slug must be "${slugify(p.name)}"`);
    if (!CatalogueProduct.CATEGORIES.includes(p.category)) bad(`invalid category "${p.category}"`);
    if (!CatalogueProduct.USES.includes(p.use)) bad(`invalid use "${p.use}"`);
    if (!CatalogueProduct.PREGNANCY.includes(p.pregnancy)) bad(`invalid pregnancy "${p.pregnancy}"`);
    for (const key of ['keyActives', 'strengths', 'suitableFor']) {
      if (!isStringArray(p[key])) bad(`${key} must be an array of strings`);
    }
    if (typeof p.ingredients !== 'string') bad('ingredients must be a string');

    // Duplicates inside the file would make insertMany fail half way, so catch them here.
    if (seenSlugs.has(p.slug)) bad('duplicate slug in products.json');
    seenSlugs.add(p.slug);
    const nameKey = typeof p.name === 'string' ? p.name.trim().toLowerCase() : '';
    if (nameKey && seenNames.has(nameKey)) bad('duplicate name in products.json (case-insensitive)');
    seenNames.add(nameKey);

    let photo;
    if (p.photo !== null && p.photo !== undefined) {
      if (typeof p.photo !== 'string' || p.photo !== path.basename(p.photo)) {
        bad('photo must be null or a plain file name inside photos/');
      } else {
        const photoPath = path.join(photosDir, p.photo);
        if (!fs.existsSync(photoPath)) bad(`photo file not found: ${p.photo}`);
        else {
          const data = fs.readFileSync(photoPath);
          const mimeType = detectImageType(data); // by magic bytes, not by file extension
          if (data.length > MAX_PHOTO_BYTES) bad(`photo ${p.photo} is larger than ${MAX_PHOTO_BYTES} bytes`);
          else if (!mimeType) bad(`photo ${p.photo} is not a JPEG or PNG image`);
          else photo = { data, mimeType, size: data.length };
        }
      }
    }

    const doc = {
      seedKey: p.slug, // permanent: the slug the product has in the seed file
      slug: p.slug, name: p.name, category: p.category, use: p.use, pregnancy: p.pregnancy,
      keyActives: p.keyActives, strengths: p.strengths, suitableFor: p.suitableFor,
      ingredients: p.ingredients,
    };
    if (photo) doc.photo = photo;
    products.push(doc);
  });

  return { products, problems };
}

// Pure: decides what to insert. `existing` = [{ seedKey, slug, nameKey }] of the documents in
// the collection. Returns { toInsert, skipped, warnings }:
//  - seedKey already in the DB -> skipped quietly (already seeded; maybe renamed since).
//  - else slug or name already used by another document -> skipped WITH a warning.
//  - else -> toInsert.
function planInserts(products, existing) {
  const seedKeys = new Set(existing.map(d => d.seedKey).filter(Boolean));
  const slugs = new Set(existing.map(d => d.slug));
  const nameKeys = new Set(existing.map(d => d.nameKey));
  const toInsert = [];
  const skipped = [];
  const warnings = [];
  for (const product of products) {
    if (seedKeys.has(product.seedKey)) {
      skipped.push(product);
    } else if (slugs.has(product.slug) || nameKeys.has(product.name.trim().toLowerCase())) {
      skipped.push(product);
      warnings.push(`WARNING: skipped "${product.slug}": another product already uses this slug or name (not touched).`);
    } else {
      toInsert.push(product);
    }
  }
  return { toInsert, skipped, warnings };
}

// Does the whole run and returns { inserted, skipped, dryRun } (or throws).
// Options (all optional; the injected ones exist so tests never touch Mongo):
//   dryRun, dataDir, model (default CatalogueProduct), log (default console.log).
// When no model is injected the function connects to MONGODB_URI itself and disconnects after.
async function seedCatalogue({ dryRun = false, dataDir = DEFAULT_DATA_DIR, model, log = console.log } = {}) {
  // 1. Validate everything BEFORE touching the DB: a bad file must write nothing.
  const { products, problems } = loadSeed(dataDir);
  if (problems.length) {
    problems.forEach(msg => log(`PROBLEM: ${msg}`));
    throw new Error(`Seed data has ${problems.length} problem(s); nothing was written.`);
  }

  const connectHere = !model;
  const Model = model || CatalogueProduct;
  if (connectHere) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await mongoose.connect(process.env.MONGODB_URI);
  }
  // Dry run = no documents are written. (Mongoose may still create the empty collection and
  // its indexes on connect; that is harmless and the server does the same on boot.)
  try {
    log(`Loaded ${products.length} product(s) from the seed file.`);
    const existing = await Model.find({}, 'seedKey slug nameKey').lean();
    const { toInsert, skipped, warnings } = planInserts(products, existing);
    warnings.forEach(w => log(w));

    if (dryRun) {
      toInsert.forEach(p => log(`would insert: ${p.slug}`));
      log(`Would insert ${toInsert.length}, skip ${skipped.length} (already present).`);
    } else {
      // init() builds the model's indexes if missing (it never drops anything, unlike
      // syncIndexes). The unique slug / nameKey indexes are the last guard against
      // duplicates, so they must exist before we insert.
      await Model.init();
      if (toInsert.length) await Model.insertMany(toInsert, { ordered: true });
      toInsert.forEach(p => log(`inserted: ${p.slug}`));
      log(`Inserted ${toInsert.length}, skipped ${skipped.length} (already present).`);
    }
    return { inserted: dryRun ? 0 : toInsert.length, skipped: skipped.length, dryRun };
  } finally {
    if (connectHere) await mongoose.disconnect();
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => seedCatalogue(parseArgs(process.argv.slice(2))))
    .catch(err => {
      console.error(err.message); // message only: never the URI
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, loadSeed, planInserts, seedCatalogue };
