// Tests for services/loginLinks.js with an in-memory fake model (no DB, no network).
process.env.JWT_SECRET = 'test-secret';
process.env.CONSENT_VERSION = '2026-09';

const svc = require('./loginLinks');

const NOW = new Date('2026-10-12T10:00:00Z');
const HOUR = 3600 * 1000;

// ---- tiny fakes ----------------------------------------------------------------------------

// Supports the filter shapes the service uses: equality, null, { $gt: date } and dotted paths.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && '$gt' in cond) return val > cond.$gt;
    if (cond === null) return val == null;
    return String(val) === String(cond);
  });
}

function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {});
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
}

function makeFakes() {
  let seq = 0;
  const rows = [];
  const users = [];
  const LoginLink = {
    LIFETIME_HOURS: 72,
    rows,
    create: jest.fn(async fields => {
      const doc = { _id: `l${++seq}`, usedAt: null, revokedAt: null, sendCount: 0, lastSentAt: null,
        lastSendError: null, userId: null, createdAt: new Date(NOW.getTime() + seq), ...fields };
      rows.push(doc);
      return doc;
    }),
    updateMany: jest.fn(async (filter, update) => { rows.filter(r => matches(r, filter)).forEach(r => applyUpdate(r, update)); }),
    updateOne: jest.fn(async (filter, update) => { const r = rows.find(x => matches(x, filter)); if (r) applyUpdate(r, update); }),
    findById: jest.fn(async id => rows.find(r => r._id === id) || null),
    findOne: jest.fn(async filter => rows.find(r => matches(r, filter)) || null),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const r = rows.find(x => matches(x, filter));
      if (!r) return null;
      applyUpdate(r, update);
      return r;
    }),
    find: jest.fn(filter => {
      let out = rows.filter(r => matches(r, filter));
      const chain = {
        sort: () => { out = [...out].sort((a, b) => b.createdAt - a.createdAt); return chain; },
        limit: n => { out = out.slice(0, n); return chain; },
        then: (res, rej) => Promise.resolve(out).then(res, rej),
      };
      return chain;
    }),
  };
  const User = {
    users,
    findOne: jest.fn(async filter => users.find(u => matches(u, filter)) || null),
    findById: jest.fn(async id => users.find(u => u._id === id) || null),
    create: jest.fn(async fields => { const u = { _id: `u${users.length + 1}`, ...fields }; users.push(u); return u; }),
  };
  return { LoginLink, User, rows, users };
}

function setup(extra = {}) {
  const f = makeFakes();
  const deps = {
    LoginLink: f.LoginLink, User: f.User, now: () => NOW,
    mail: { sendSignInLink: jest.fn().mockResolvedValue() },
    rateLimit: jest.fn().mockResolvedValue(true),
    ...extra,
  };
  return { ...f, deps };
}

const goodConsent = () => ({ consentAcceptedAt: new Date(NOW.getTime() - 1000).toISOString(), consentVersion: '2026-09' });
// Pulls the raw token out of a link URL.
const tokenOf = link => link.split('#signin=')[1];

beforeEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ---- token helpers -------------------------------------------------------------------------

describe('token, hash and encryption', () => {
  test('encrypt/decrypt round trip, with a fresh iv each time', () => {
    const a = svc.encryptToken('hello');
    const b = svc.encryptToken('hello');
    expect(a).not.toBe(b);
    expect(svc.decryptToken(a)).toBe('hello');
    expect(Buffer.from(a, 'base64').length).toBe(12 + 16 + 5);
  });

  test('tampering, a truncated value or another key gives null', () => {
    const enc = svc.encryptToken('hello');
    const buf = Buffer.from(enc, 'base64');
    buf[buf.length - 1] ^= 1;
    expect(svc.decryptToken(buf.toString('base64'))).toBeNull();
    expect(svc.decryptToken('AAAA')).toBeNull();
    process.env.JWT_SECRET = 'other-secret';
    expect(svc.decryptToken(enc)).toBeNull();
    process.env.JWT_SECRET = 'test-secret';
  });

  test('hash is hex sha256', () => {
    expect(svc.hashToken('x')).toMatch(/^[a-f0-9]{64}$/);
  });

  test('link format uses PUBLIC_BASE_URL without a trailing slash, default getpretty.app', async () => {
    const { deps } = setup();
    let made = await svc.createForUser('u1', 'admin@x.co', deps);
    expect(made.link).toMatch(/^https:\/\/getpretty\.app\/#signin=[A-Za-z0-9_-]{43}$/);
    process.env.PUBLIC_BASE_URL = 'https://example.test//';
    made = await svc.createForUser('u1', 'admin@x.co', deps);
    expect(made.link.startsWith('https://example.test/#signin=')).toBe(true);
  });

  test('the stored row has the hash of the token in the link, and decrypts back to it', async () => {
    const { deps, rows } = setup();
    const { link } = await svc.createForUser('u1', 'admin@x.co', deps);
    expect(rows[0].tokenHash).toBe(svc.hashToken(tokenOf(link)));
    expect(svc.decryptToken(rows[0].tokenEnc)).toBe(tokenOf(link));
  });
});

// ---- create --------------------------------------------------------------------------------

describe('createForUser / createInvite', () => {
  test('signin link lives 72h and revokes the older unused links of that user only', async () => {
    const { deps, rows } = setup();
    await svc.createForUser('u1', 'a@x.co', deps);
    await svc.createForUser('u2', 'a@x.co', deps);
    const second = await svc.createForUser('u1', 'a@x.co', deps);
    expect(rows[0].revokedAt).toEqual(NOW);
    expect(rows[1].revokedAt).toBeNull();
    expect(second.linkDoc.revokedAt).toBeNull();
    expect(second.linkDoc.expiresAt).toEqual(new Date(NOW.getTime() + 72 * HOUR));
    expect(second.linkDoc.createdByAdminEmail).toBe('a@x.co');
  });

  test('an already used link is not touched by a new one', async () => {
    const { deps, rows } = setup();
    await svc.createForUser('u1', 'a@x.co', deps);
    rows[0].usedAt = NOW;
    await svc.createForUser('u1', 'a@x.co', deps);
    expect(rows[0].revokedAt).toBeNull();
  });

  test('invite normalises the email, defaults the language to he, revokes older invites for it', async () => {
    const { deps, rows } = setup();
    const first = await svc.createInvite({ email: ' New@Example.COM ', firstName: ' Ada ', language: 'xx' }, 'a@x.co', deps);
    expect(first.ok).toBe(true);
    expect(first.linkDoc.purpose).toBe('invite');
    expect(first.linkDoc.invite).toEqual({ email: 'new@example.com', firstName: 'Ada', language: 'he' });
    await svc.createInvite({ email: 'other@example.com' }, 'a@x.co', deps);
    const again = await svc.createInvite({ email: 'new@example.com', language: 'en' }, 'a@x.co', deps);
    expect(rows[0].revokedAt).toEqual(NOW);
    expect(rows[1].revokedAt).toBeNull();
    expect(again.linkDoc.invite.language).toBe('en');
  });

  test('invite for an existing account creates a signin link and returns existingUserId', async () => {
    const { deps, users } = setup();
    users.push({ _id: 'u9', email: 'have@example.com' });
    const res = await svc.createInvite({ email: 'HAVE@example.com' }, 'a@x.co', deps);
    expect(res.ok).toBe(true);
    expect(res.existingUserId).toBe('u9');
    expect(res.linkDoc.purpose).toBe('signin');
    expect(res.linkDoc.userId).toBe('u9');
  });

  test('invalid email is rejected and nothing is created', async () => {
    const { deps, rows } = setup();
    for (const email of ['nope', '', undefined, 42, `${'a'.repeat(250)}@b.co`]) {
      expect(await svc.createInvite({ email }, 'a@x.co', deps)).toEqual({ ok: false, code: 'invite_invalid' });
    }
    expect(rows).toHaveLength(0);
  });
});

// ---- status, reveal, lists -----------------------------------------------------------------

describe('linkStatus / revealLink / lists', () => {
  const base = { expiresAt: new Date(NOW.getTime() + HOUR), usedAt: null, revokedAt: null };

  test('status', () => {
    expect(svc.linkStatus(base, NOW)).toBe('active');
    expect(svc.linkStatus({ ...base, expiresAt: NOW }, NOW)).toBe('expired');
    expect(svc.linkStatus({ ...base, revokedAt: NOW }, NOW)).toBe('revoked');
    expect(svc.linkStatus({ ...base, usedAt: NOW }, NOW)).toBe('used');
    // used wins over revoked/expired
    expect(svc.linkStatus({ ...base, usedAt: NOW, revokedAt: NOW, expiresAt: NOW }, NOW)).toBe('used');
  });

  test('reveal only when active', async () => {
    const { deps } = setup();
    const { link, linkDoc } = await svc.createForUser('u1', 'a@x.co', deps);
    expect(svc.revealLink(linkDoc, NOW)).toBe(link);
    expect(svc.revealLink({ ...linkDoc, usedAt: NOW }, NOW)).toBeNull();
    expect(svc.revealLink({ ...linkDoc, revokedAt: NOW }, NOW)).toBeNull();
    expect(svc.revealLink(linkDoc, new Date(NOW.getTime() + 100 * HOUR))).toBeNull();
    expect(svc.revealLink({ ...linkDoc, tokenEnc: 'garbage' }, NOW)).toBeNull();
  });

  test('listForUser returns the newest 5 rows, link only on the active one', async () => {
    const { deps } = setup();
    for (let i = 0; i < 7; i += 1) await svc.createForUser('u1', 'a@x.co', deps);
    await svc.createForUser('u2', 'a@x.co', deps);
    const rows = await svc.listForUser('u1', deps);
    expect(rows).toHaveLength(5);
    expect(rows[0].status).toBe('active');
    expect(rows[0].link).toMatch(/#signin=/);
    expect(rows[1].status).toBe('revoked');
    expect(rows[1].link).toBeNull();
    expect(rows.every(r => r.purpose === 'signin')).toBe(true);
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(
      ['id', 'purpose', 'status', 'link', 'createdAt', 'createdByAdminEmail', 'expiresAt', 'usedAt', 'lastSentAt', 'sendCount', 'lastSendError', 'invite']));
  });

  test('listPendingInvites shows only active invites, newest first', async () => {
    const { deps, rows } = setup();
    await svc.createInvite({ email: 'a@example.com' }, 'x', deps);
    await svc.createInvite({ email: 'b@example.com' }, 'x', deps);
    await svc.createInvite({ email: 'c@example.com' }, 'x', deps);
    rows[2].usedAt = NOW; // c was redeemed
    await svc.createForUser('u1', 'x', deps); // a signin link is not an invite
    const list = await svc.listPendingInvites(deps);
    expect(list.map(r => r.invite.email)).toEqual(['b@example.com', 'a@example.com']);
  });
});

// ---- sendLinkEmail -------------------------------------------------------------------------

describe('sendLinkEmail', () => {
  test('signin link: emails the user, updates counters', async () => {
    const { deps, users, rows } = setup();
    users.push({ _id: 'u1', email: 'ada@example.com', firstName: 'Ada', language: 'en' });
    const { link, linkDoc } = await svc.createForUser('u1', 'a@x.co', deps);
    expect(await svc.sendLinkEmail(linkDoc._id, deps)).toEqual({ ok: true });
    expect(deps.mail.sendSignInLink).toHaveBeenCalledWith(
      { to: 'ada@example.com', firstName: 'Ada', language: 'en', link, expiresAt: linkDoc.expiresAt, purpose: 'signin' });
    expect(deps.rateLimit).toHaveBeenCalledWith('link_send', 'u1', 5, HOUR);
    expect(rows[0]).toMatchObject({ sendCount: 1, lastSentAt: NOW, lastSendError: null });
    await svc.sendLinkEmail(linkDoc._id, deps);
    expect(rows[0].sendCount).toBe(2);
  });

  test('invite: emails the invited address, rate limit keyed by an HMAC of the email (never the raw address)', async () => {
    const { deps } = setup();
    const { linkDoc } = await svc.createInvite({ email: 'new@example.com', firstName: 'Neo', language: 'he' }, 'a', deps);
    expect(await svc.sendLinkEmail(linkDoc._id, deps)).toEqual({ ok: true });
    expect(deps.mail.sendSignInLink.mock.calls[0][0]).toMatchObject({ to: 'new@example.com', firstName: 'Neo', language: 'he', purpose: 'invite' });
    const key = deps.rateLimit.mock.calls[0][1];
    expect(key).toBe(require('crypto').createHmac('sha256', 'test-secret').update('new@example.com').digest('hex'));
    expect(key).not.toContain('new@example.com');
  });

  test('link_not_active for unknown, used, revoked, expired links or a deleted user; mail not called', async () => {
    const { deps, rows, users } = setup();
    users.push({ _id: 'u1', email: 'a@b.co' });
    expect(await svc.sendLinkEmail('nope', deps)).toEqual({ ok: false, code: 'link_not_active' });
    const { linkDoc } = await svc.createForUser('u1', 'a', deps);
    for (const patch of [{ usedAt: NOW }, { revokedAt: NOW }, { expiresAt: NOW }]) {
      const saved = { usedAt: rows[0].usedAt, revokedAt: rows[0].revokedAt, expiresAt: rows[0].expiresAt };
      Object.assign(rows[0], patch);
      expect(await svc.sendLinkEmail(linkDoc._id, deps)).toEqual({ ok: false, code: 'link_not_active' });
      Object.assign(rows[0], saved);
    }
    users.length = 0;
    expect(await svc.sendLinkEmail(linkDoc._id, deps)).toEqual({ ok: false, code: 'link_not_active' });
    expect(deps.mail.sendSignInLink).not.toHaveBeenCalled();
  });

  test('rate_limited: no email, no counter change', async () => {
    const { deps, users, rows } = setup({ rateLimit: jest.fn().mockResolvedValue(false) });
    users.push({ _id: 'u1', email: 'a@b.co' });
    const { linkDoc } = await svc.createForUser('u1', 'a', deps);
    expect(await svc.sendLinkEmail(linkDoc._id, deps)).toEqual({ ok: false, code: 'rate_limited' });
    expect(deps.mail.sendSignInLink).not.toHaveBeenCalled();
    expect(rows[0].sendCount).toBe(0);
  });

  test('mail_not_configured and send_failed store a SHORT reason, never the raw error', async () => {
    const { deps, users, rows } = setup();
    users.push({ _id: 'u1', email: 'a@b.co' });
    const { linkDoc } = await svc.createForUser('u1', 'a', deps);

    const notConfigured = Object.assign(new Error('POSTMARK_API_KEY is not set'), { code: 'mail_not_configured' });
    deps.mail.sendSignInLink.mockRejectedValueOnce(notConfigured);
    expect(await svc.sendLinkEmail(linkDoc._id, deps)).toEqual({ ok: false, code: 'mail_not_configured' });
    expect(rows[0].lastSendError).toBe('mail_not_configured');

    deps.mail.sendSignInLink.mockRejectedValueOnce(new Error('rejected recipient a@b.co'));
    expect(await svc.sendLinkEmail(linkDoc._id, deps)).toEqual({ ok: false, code: 'send_failed' });
    expect(rows[0].lastSendError).toBe('send_failed');
    expect(rows[0].sendCount).toBe(0);
    // Nothing sensitive was logged.
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('a@b.co');

    // A later success clears the error.
    await svc.sendLinkEmail(linkDoc._id, deps);
    expect(rows[0].lastSendError).toBeNull();
  });
});

// ---- redeem --------------------------------------------------------------------------------

describe('redeem', () => {
  async function signinFixture(extra) {
    const s = setup(extra);
    s.users.push({ _id: 'u1', email: 'ada@example.com', firstName: 'Ada' });
    const made = await svc.createForUser('u1', 'a', s.deps);
    return { ...s, token: tokenOf(made.link), row: s.rows[0] };
  }

  test('unknown or malformed token -> link_invalid', async () => {
    const { deps } = setup();
    for (const token of ['nope', '', undefined, 5, 'x'.repeat(300)]) {
      expect(await svc.redeem({ token }, deps)).toEqual({ ok: false, code: 'link_invalid' });
    }
  });

  test('expired, used and revoked links -> link_invalid', async () => {
    const { deps, token, row } = await signinFixture();
    for (const patch of [{ expiresAt: NOW }, { usedAt: NOW }, { revokedAt: NOW }]) {
      const saved = { usedAt: row.usedAt, revokedAt: row.revokedAt, expiresAt: row.expiresAt };
      Object.assign(row, patch);
      expect(await svc.redeem({ token }, deps)).toEqual({ ok: false, code: 'link_invalid' });
      Object.assign(row, saved);
    }
  });

  test('lost race at the atomic consume -> link_invalid', async () => {
    const { deps, token } = await signinFixture();
    deps.LoginLink.findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await svc.redeem({ token }, deps)).toEqual({ ok: false, code: 'link_invalid' });
  });

  test('signin happy path: returns the user, consumes the link, second use fails', async () => {
    const { deps, token, row } = await signinFixture();
    const res = await svc.redeem({ token }, deps);
    expect(res).toMatchObject({ ok: true, isNew: false, user: { _id: 'u1' } });
    expect(row.usedAt).toEqual(NOW);
    expect(await svc.redeem({ token }, deps)).toEqual({ ok: false, code: 'link_invalid' });
  });

  test('signin link whose user was deleted -> link_invalid', async () => {
    const { deps, token, users } = await signinFixture();
    users.length = 0;
    expect(await svc.redeem({ token }, deps)).toEqual({ ok: false, code: 'link_invalid' });
  });

  async function inviteFixture(opts = {}) {
    const s = setup();
    const made = await svc.createInvite({ email: 'new@example.com', firstName: 'Neo', language: 'en' }, 'a', s.deps);
    return { ...s, token: tokenOf(made.link), row: s.rows[0], ...opts };
  }

  test('invite without consent -> consent_required and the link is NOT consumed', async () => {
    const { deps, token, row, users } = await inviteFixture();
    const res = await svc.redeem({ token }, deps);
    expect(res).toMatchObject({ ok: false, code: 'consent_required', status: 400 });
    expect(row.usedAt).toBeNull();
    expect(users).toHaveLength(0);
    expect(deps.LoginLink.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('invite with an outdated consent version -> consent_outdated, not consumed', async () => {
    const { deps, token, row } = await inviteFixture();
    const res = await svc.redeem({ token, ...goodConsent(), consentVersion: 'old' }, deps);
    expect(res).toMatchObject({ ok: false, code: 'consent_outdated' });
    expect(row.usedAt).toBeNull();
  });

  test('invite happy path creates the user with invitedAt and consent fields, stores userId', async () => {
    const { deps, token, row, users } = await inviteFixture();
    const res = await svc.redeem({ token, ...goodConsent() }, deps);
    expect(res).toMatchObject({ ok: true, isNew: true });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: 'new@example.com', firstName: 'Neo', language: 'en', invitedAt: NOW,
      termsAcceptedAt: NOW, privacyAcceptedAt: NOW, consentVersion: '2026-09',
    });
    expect(row.usedAt).toEqual(NOW);
    expect(row.userId).toBe(users[0]._id);
  });

  test('invite whose email registered meanwhile: uses that account, no consent needed, isNew false', async () => {
    const { deps, token, row, users } = await inviteFixture();
    users.push({ _id: 'u7', email: 'new@example.com' });
    const res = await svc.redeem({ token }, deps);
    expect(res).toMatchObject({ ok: true, isNew: false, user: { _id: 'u7' } });
    expect(deps.User.create).not.toHaveBeenCalled();
    expect(row.userId).toBe('u7');
  });

  test('duplicate-email race on create -> uses the existing account', async () => {
    const { deps, token, users, row } = await inviteFixture();
    deps.User.create.mockImplementationOnce(async () => {
      users.push({ _id: 'u8', email: 'new@example.com' });
      throw Object.assign(new Error('dup'), { code: 11000, keyPattern: { email: 1 } });
    });
    const res = await svc.redeem({ token, ...goodConsent() }, deps);
    expect(res).toMatchObject({ ok: true, isNew: false, user: { _id: 'u8' } });
    expect(row.userId).toBe('u8');
  });

  test('another create error is rethrown', async () => {
    const { deps, token } = await inviteFixture();
    deps.User.create.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.redeem({ token, ...goodConsent() }, deps)).rejects.toThrow('db down');
  });
});
