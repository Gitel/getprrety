const { sendSignInLink, buildSignInEmail } = require('./mail');

const OLD_ENV = process.env;
beforeEach(() => {
  process.env = { ...OLD_ENV, POSTMARK_SENDER_ADDRESS: 'noreply@example.com' };
  delete process.env.POSTMARK_API_KEY;
});
afterAll(() => { process.env = OLD_ENV; });

const LINK = 'https://getpretty.app/#signin=SECRETTOKEN123';
// 11:30 UTC on 2026-10-15 is 14:30 in Israel (summer time, UTC+3, until late October).
const EXPIRES = new Date('2026-10-15T11:30:00Z');
const base = { firstName: 'Ada', link: LINK, expiresAt: EXPIRES, purpose: 'signin' };

test('English sign-in email: wording, button, expiry in Israel time, ignore line', () => {
  const m = buildSignInEmail({ ...base, language: 'en' });
  expect(m.subject).toBe('Your GetPretty sign-in link');
  expect(m.html).toContain('dir="ltr"');
  expect(m.html).toContain(`href="${LINK}"`);
  expect(m.html).toContain('2026-10-15 14:30');
  expect(m.html).toContain('If you did not expect this email, ignore it.');
  expect(m.text).toContain(LINK);
  expect(m.text).toContain('If you did not expect this email, ignore it.');
  expect((m.html.match(/<a /g) || []).length).toBe(1);
});

test('Hebrew email is RTL, and an unknown or missing language falls back to Hebrew', () => {
  for (const language of ['he', 'fr', undefined, null]) {
    const m = buildSignInEmail({ ...base, language });
    expect(m.html).toContain('dir="rtl"');
    expect(m.subject).not.toMatch(/Your GetPretty/);
  }
});

test('invite wording differs from sign-in wording', () => {
  const a = buildSignInEmail({ ...base, language: 'en', purpose: 'invite' });
  const b = buildSignInEmail({ ...base, language: 'en', purpose: 'signin' });
  expect(a.subject).toBe('You are invited to GetPretty');
  expect(a.subject).not.toBe(b.subject);
  expect(a.html).not.toBe(b.html);
});

test('the subject never contains the token', () => {
  for (const language of ['en', 'he']) {
    for (const purpose of ['signin', 'invite']) {
      expect(buildSignInEmail({ ...base, language, purpose }).subject).not.toContain('SECRETTOKEN123');
    }
  }
});

test('the name is HTML-escaped and stripped of line breaks', () => {
  const m = buildSignInEmail({ ...base, language: 'en', firstName: '<b>Ada</b>\nBcc: x' });
  expect(m.html).not.toContain('<b>Ada');
  expect(m.html).toContain('&lt;b&gt;Ada');
  expect(m.text).not.toContain('\nBcc');
});

test('sends through the injected client with sender, stream and recipient', async () => {
  const client = { sendEmail: jest.fn().mockResolvedValue({}) };
  await sendSignInLink({ ...base, to: 'ada@example.com', language: 'en' }, { client });
  const arg = client.sendEmail.mock.calls[0][0];
  expect(arg).toMatchObject({ From: 'noreply@example.com', To: 'ada@example.com', MessageStream: 'outbound' });
  expect(arg.HtmlBody).toContain(LINK);
  expect(arg.TextBody).toContain(LINK);
});

test('throws mail_not_configured when there is no client or no sender', async () => {
  await expect(sendSignInLink({ ...base, to: 'a@b.co', language: 'en' }, {}))
    .rejects.toMatchObject({ code: 'mail_not_configured' });
  delete process.env.POSTMARK_SENDER_ADDRESS;
  const client = { sendEmail: jest.fn() };
  await expect(sendSignInLink({ ...base, to: 'a@b.co', language: 'en' }, { client }))
    .rejects.toMatchObject({ code: 'mail_not_configured' });
  expect(client.sendEmail).not.toHaveBeenCalled();
});

test('a Postmark rejection propagates unchanged', async () => {
  const client = { sendEmail: jest.fn().mockRejectedValue(new Error('boom')) };
  await expect(sendSignInLink({ ...base, to: 'a@b.co', language: 'en' }, { client })).rejects.toThrow('boom');
});
