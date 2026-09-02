const postmark = require('postmark');
const SkinAnalysis = require('../models/SkinAnalysis');
const User = require('../models/User');

// Comma-separated list is passed straight through to Postmark's `To` field.
const CLINIC_TO = process.env.CLINIC_NOTIFY_TO || 'lutreat@gmail.com,dzaturansky@gmail.com';
const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM || 'outbound';

let cachedClient = null;

// Lazily build the Postmark client so the server still boots (and tests still run)
// when POSTMARK_API_KEY isn't set. Returns null when email can't be sent.
function getClient() {
  if (cachedClient) return cachedClient;
  if (!process.env.POSTMARK_API_KEY) return null;
  cachedClient = new postmark.ServerClient(process.env.POSTMARK_API_KEY);
  return cachedClient;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function joinList(value) {
  if (!Array.isArray(value)) return typeof value === 'string' ? value : '';
  return value.filter(Boolean).join(', ');
}

function renderRoutine(routine) {
  if (!routine || typeof routine !== 'object') return '<p><em>See full profile in dashboard.</em></p>';
  const side = (steps, label) => {
    if (!Array.isArray(steps) || !steps.length) return '';
    const items = steps
      .map(s => `<li>${esc(s?.name || s)}${s?.description ? ` &mdash; ${esc(s.description)}` : ''}</li>`)
      .join('');
    return `<p style="margin:8px 0 2px;"><strong>${label}</strong></p><ol style="margin:0 0 8px 18px;padding:0;">${items}</ol>`;
  };
  const body = side(routine.am, 'AM') + side(routine.pm, 'PM');
  return body || '<p><em>See full profile in dashboard.</em></p>';
}

// customer here is a { analysis, user } pair — the app has no single "customer" document.
function buildClinicEmailHtml({ analysis, user }) {
  const answers = (analysis && analysis.quizAnswers) || {};
  const name = answers.name || (user && user.firstName) || 'Unknown';
  const email = (user && user.email) || 'no email on file';
  const phone = answers.phone || 'no phone';

  const allergies = (Array.isArray(answers.allergies) ? answers.allergies : [])
    .filter(a => a && String(a).toLowerCase() !== 'none');
  if (answers.allergies_other) allergies.push(String(answers.allergies_other));

  const allergyBlock = allergies.length
    ? `<p style="color:#b3261e;font-weight:bold;font-size:15px;">&#9888; Allergies: ${esc(allergies.join(', '))}</p>`
    : `<p style="font-weight:bold;">&#9888; No allergies reported</p>`;

  const era = (analysis && analysis.era) || {};
  const eraName = era.name || (analysis && analysis.eraId) || 'n/a';

  const concerns = joinList(answers.skin_goals) || answers.top_concern || 'n/a';
  const base = (process.env.PUBLIC_BASE_URL || 'https://getpretty.app').replace(/\/+$/, '');

  return `
    ${allergyBlock}
    <p><strong>${esc(name)}</strong> &middot; ${esc(email)} &middot; ${esc(phone)}</p>
    <p><strong>Skin Era:</strong> ${esc(eraName)}</p>
    <p><strong>Top concerns:</strong> ${esc(concerns)}</p>
    <p><strong>Routine:</strong></p>
    ${renderRoutine(analysis && analysis.routine)}
    <p><a href="${base}/admin/customer/${analysis && analysis._id}">View full profile in dashboard &rarr;</a></p>
  `.trim();
}

/**
 * Send the clinic a summary email for a completed quiz/analysis.
 * @param {string|object} analysisOrId  SkinAnalysis document or its id.
 * @param {object} [opts]
 * @param {boolean} [opts.force]   Bypass the clinicNotifiedAt idempotency guard (manual resend).
 * @param {object}  [opts.client]  Injected Postmark-like client ({ sendEmail }) — for tests.
 */
async function notifyClinic(analysisOrId, { force = false, client } = {}) {
  const analysis = analysisOrId && typeof analysisOrId.save === 'function'
    ? analysisOrId
    : await SkinAnalysis.findById(analysisOrId);
  if (!analysis) return { sent: false, reason: 'analysis-not-found' };
  if (analysis.clinicNotifiedAt && !force) return { sent: false, reason: 'already-notified' };

  const mail = client || getClient();
  if (!mail) {
    console.warn('clinicNotify: POSTMARK_API_KEY not set — skipping clinic notification');
    return { sent: false, reason: 'no-client' };
  }
  const from = process.env.POSTMARK_SENDER_ADDRESS;
  if (!from) {
    console.warn('clinicNotify: POSTMARK_SENDER_ADDRESS not set — skipping clinic notification');
    return { sent: false, reason: 'no-sender' };
  }

  const user = analysis.userId ? await User.findById(analysis.userId) : null;
  const name = (analysis.quizAnswers && analysis.quizAnswers.name)
    || (user && user.firstName)
    || 'client';
  const eraName = (analysis.era && analysis.era.name) || analysis.eraId || 'skin reading';

  await mail.sendEmail({
    From: from,
    To: CLINIC_TO,
    Subject: `New GetPretty client: ${name} — ${eraName}`,
    HtmlBody: buildClinicEmailHtml({ analysis, user }),
    MessageStream: MESSAGE_STREAM,
  });

  analysis.clinicNotifiedAt = new Date();
  await analysis.save();
  return { sent: true };
}

module.exports = { notifyClinic, buildClinicEmailHtml };
