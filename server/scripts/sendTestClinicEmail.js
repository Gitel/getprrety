#!/usr/bin/env node

// Send ONE clinic-notification email to an arbitrary address, built from a real
// existing SkinAnalysis — for verifying formatting and deliverability. Read-only:
// it does NOT set clinicNotifiedAt or modify any record.
//
//   node scripts/sendTestClinicEmail.js --to=dzaturansky@gmail.com
//   node scripts/sendTestClinicEmail.js --to=you@example.com --id=<analysisId>
//
// Needs MONGODB_URI, POSTMARK_API_KEY, POSTMARK_SENDER_ADDRESS in server/.env.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const postmark = require('postmark');
const mongoose = require('mongoose');
const SkinAnalysis = require('../models/SkinAnalysis');
const User = require('../models/User');
const { buildClinicEmailHtml } = require('../services/clinicNotify');

function parseArgs(argv) {
  const args = { to: null, id: null };
  for (const arg of argv) {
    const to = /^--to=(.+)$/.exec(arg);
    const id = /^--id=(.+)$/.exec(arg);
    if (to) args.to = to[1].trim();
    else if (id) args.id = id[1].trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.to) throw new Error('--to=<email> is required');
  return args;
}

async function run(argv = process.argv.slice(2)) {
  const { to, id } = parseArgs(argv);
  for (const key of ['MONGODB_URI', 'POSTMARK_API_KEY', 'POSTMARK_SENDER_ADDRESS']) {
    if (!process.env[key]) throw new Error(`${key} is required`);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const analysis = id
      ? await SkinAnalysis.findById(id).lean()
      : await SkinAnalysis.findOne().sort({ createdAt: -1 }).lean();
    if (!analysis) throw new Error(id ? `No SkinAnalysis with id ${id}` : 'No SkinAnalysis records found');

    const user = analysis.userId ? await User.findById(analysis.userId).lean() : null;
    const name = (analysis.quizAnswers && analysis.quizAnswers.name) || (user && user.firstName) || 'client';
    const eraName = (analysis.era && analysis.era.name) || analysis.eraId || 'skin reading';

    const client = new postmark.ServerClient(process.env.POSTMARK_API_KEY);
    const res = await client.sendEmail({
      From: process.env.POSTMARK_SENDER_ADDRESS,
      To: to,
      Subject: `[TEST] New GetPretty client: ${name} — ${eraName}`,
      HtmlBody: buildClinicEmailHtml({ analysis, user }),
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
    });

    console.log(`Sent test email to ${to}`);
    console.log(`  source analysis: ${analysis._id}  (${name} — ${eraName}, ${new Date(analysis.createdAt).toISOString()})`);
    console.log(`  postmark MessageID: ${res.MessageID}  ErrorCode: ${res.ErrorCode}`);
    console.log('  (clinicNotifiedAt was NOT modified)');
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run()
    .then(code => process.exit(code))
    .catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { parseArgs, run };
