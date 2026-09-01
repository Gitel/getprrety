#!/usr/bin/env node

// One-off backfill: send the clinic (CLINIC_NOTIFY_TO) a notification for recent
// completed quizzes that never triggered one — e.g. quizzes finished before the
// notifyClinic feature shipped. Safe to re-run: the clinicNotifiedAt guard inside
// notifyClinic() makes every already-sent record a no-op.
//
//   node scripts/backfillClinicNotify.js --days=30 --dry-run
//   node scripts/backfillClinicNotify.js --days=30
//
// Needs MONGODB_URI, POSTMARK_API_KEY, POSTMARK_SENDER_ADDRESS in server/.env.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const SkinAnalysis = require('../models/SkinAnalysis');
const { notifyClinic } = require('../services/clinicNotify');

const DEFAULT_DAYS = 30;
const SEND_SPACING_MS = 150;

function parseArgs(argv) {
  const args = { days: DEFAULT_DAYS, dryRun: false };
  for (const arg of argv) {
    const m = /^--days=(\d+)$/.exec(arg);
    if (m) args.days = Number(m[1]);
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(args.days) || args.days <= 0) throw new Error('--days must be a positive integer');
  return args;
}

// Recent, not-yet-notified analyses.
function buildSelector(days, now = Date.now()) {
  return {
    clinicNotifiedAt: null,
    createdAt: { $gte: new Date(now - days * 86400000) },
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(argv = process.argv.slice(2)) {
  const { days, dryRun } = parseArgs(argv);

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  if (!dryRun && (!process.env.POSTMARK_API_KEY || !process.env.POSTMARK_SENDER_ADDRESS)) {
    throw new Error('POSTMARK_API_KEY and POSTMARK_SENDER_ADDRESS are required for a real run (use --dry-run to preview)');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const docs = await SkinAnalysis.find(buildSelector(days)).sort({ createdAt: 1 });
    console.log(`Found ${docs.length} un-notified analysis(es) in the last ${days}d${dryRun ? '  (dry run)' : ''}`);

    let sent = 0;
    let failed = 0;
    for (const doc of docs) {
      const qa = doc.quizAnswers || {};
      const name = qa.name || 'unknown';
      const era = (doc.era && doc.era.name) || doc.eraId || 'n/a';
      const label = `${doc._id}  ${new Date(doc.createdAt).toISOString().slice(0, 16)}  ${name}  ${era}`;

      if (dryRun) { console.log(`  would send  ${label}`); continue; }

      try {
        const result = await notifyClinic(doc);
        if (result.sent) { sent++; console.log(`  sent        ${label}`); }
        else { console.log(`  skipped(${result.reason})  ${label}`); }
      } catch (err) {
        failed++;
        console.error(`  FAILED      ${label}\n              ${err.message}`);
      }
      await sleep(SEND_SPACING_MS);
    }

    console.log(`\nscanned ${docs.length}, sent ${sent}, failed ${failed}, window = last ${days}d`);
    return failed > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run()
    .then(code => process.exit(code))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { parseArgs, buildSelector, run };
