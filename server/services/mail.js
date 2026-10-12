// Transactional email for sign-in links and invites. Reuses the Postmark client and the
// POSTMARK_* environment of services/clinicNotify.js.
//
// NOTE: the Hebrew text inside the HE template strings below is intentional (non-ASCII).
const { getClient, mailConfigError, esc } = require('./clinicNotify');

const MESSAGE_STREAM = () => process.env.POSTMARK_MESSAGE_STREAM || 'outbound';
const CLINIC_TZ = 'Asia/Jerusalem';

// The wording per language and purpose. The subject NEVER contains the link/token.
const TEXTS = {
  en: {
    dir: 'ltr',
    subject: { signin: 'Your GetPretty sign-in link', invite: 'You are invited to GetPretty' },
    hello: name => (name ? `Hi ${name},` : 'Hi,'),
    body: {
      signin: 'Use the button below to sign in to GetPretty. No password needed.',
      invite: 'You have been invited to GetPretty. Use the button below to open your account.',
    },
    button: { signin: 'Sign in to GetPretty', invite: 'Open GetPretty' },
    expires: when => `This link works once and expires on ${when} (Israel time).`,
    ignore: 'If you did not expect this email, ignore it.',
  },
  // Hebrew text.
  he: {
    dir: 'rtl',
    subject: { signin: 'קישור הכניסה שלך ל-GetPretty', invite: 'הוזמנת ל-GetPretty' },
    hello: name => (name ? `שלום ${name},` : 'שלום,'),
    body: {
      signin: 'לחצו על הכפתור כדי להיכנס ל-GetPretty. אין צורך בסיסמה.',
      invite: 'הוזמנת להצטרף ל-GetPretty. לחצו על הכפתור כדי לפתוח את החשבון שלך.',
    },
    button: { signin: 'כניסה ל-GetPretty', invite: 'פתיחת GetPretty' },
    expires: when => `הקישור תקף לשימוש חד-פעמי ופג ב-${when} (שעון ישראל).`,
    ignore: 'אם לא ציפיתם להודעה זו, התעלמו ממנה.',
  },
};

// "2026-10-15 14:30" in clinic time, so the reader sees the same clock as the admin page.
function formatExpiry(expiresAt) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(expiresAt)).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// Pure builder (exported for tests): { subject, html, text } for the given language/purpose.
function buildSignInEmail({ firstName, language, link, expiresAt, purpose }) {
  const t = TEXTS[language] || TEXTS.he; // unknown or missing language falls back to Hebrew
  const kind = purpose === 'invite' ? 'invite' : 'signin';
  // A name is user-supplied: single line only (it is also escaped in the HTML).
  const name = String(firstName || '').replace(/[\r\n]+/g, ' ').trim();
  const when = formatExpiry(expiresAt);

  const html = `
    <div dir="${t.dir}" style="direction:${t.dir};text-align:${t.dir === 'rtl' ? 'right' : 'left'};font-family:Arial,sans-serif;font-size:15px;line-height:1.5;">
      <p>${esc(t.hello(name))}</p>
      <p>${esc(t.body[kind])}</p>
      <p><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#1f1f1f;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(t.button[kind])}</a></p>
      <p>${esc(t.expires(when))}</p>
      <p style="color:#666666;">${esc(t.ignore)}</p>
    </div>
  `.trim();

  const text = [t.hello(name), '', t.body[kind], '', link, '', t.expires(when), t.ignore].join('\n');
  return { subject: t.subject[kind], html, text };
}

/**
 * Email a sign-in / invite link.
 * Throws an Error with code 'mail_not_configured' when Postmark is not set up; any other
 * error is whatever Postmark threw (the caller turns it into 'send_failed').
 * @param {object} args { to, firstName, language, link, expiresAt, purpose }
 * @param {object} [deps] { client } - injected Postmark-like client ({ sendEmail }), for tests.
 */
async function sendSignInLink({ to, firstName, language, link, expiresAt, purpose }, deps = {}) {
  const client = deps.client || getClient();
  const from = process.env.POSTMARK_SENDER_ADDRESS;
  if (!client || !from) {
    const err = new Error(mailConfigError() || 'mail is not configured');
    err.code = 'mail_not_configured';
    throw err;
  }
  const { subject, html, text } = buildSignInEmail({ firstName, language, link, expiresAt, purpose });
  await client.sendEmail({
    From: from,
    To: String(to).replace(/[\r\n]+/g, ' '),
    Subject: subject,
    HtmlBody: html,
    TextBody: text,
    MessageStream: MESSAGE_STREAM(),
  });
}

module.exports = { sendSignInLink, buildSignInEmail };
