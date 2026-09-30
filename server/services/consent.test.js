const { consentError } = require('./consent');

const NOW = new Date('2026-09-23T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const at = offsetMs => new Date(NOW.getTime() + offsetMs).toISOString();

let savedVersion;
beforeEach(() => {
  savedVersion = process.env.CONSENT_VERSION;
  process.env.CONSENT_VERSION = '2026-09';
});
afterEach(() => {
  if (savedVersion === undefined) delete process.env.CONSENT_VERSION;
  else process.env.CONSENT_VERSION = savedVersion;
});

test('a fresh acceptance of the active version is valid', () => {
  expect(consentError({ consentAcceptedAt: at(-HOUR), consentVersion: '2026-09' }, NOW)).toBeNull();
});

test('missing consent is rejected', () => {
  // The Google gap this helper closes: the old client sent no consent fields at all.
  expect(consentError({}, NOW)).toEqual({ status: 400, error: 'Terms and privacy consent is required', code: 'consent_required' });
});

test('an acceptance older than 24 h, in the future, or unparseable is rejected', () => {
  for (const consentAcceptedAt of [at(-25 * HOUR), at(HOUR), 'not-a-date']) {
    expect(consentError({ consentAcceptedAt, consentVersion: '2026-09' }, NOW))
      .toEqual({ status: 400, error: 'Terms and privacy consent is required', code: 'consent_required' });
  }
});

test('an acceptance of a different policy version is rejected', () => {
  expect(consentError({ consentAcceptedAt: at(-HOUR), consentVersion: '2025-01' }, NOW))
    .toEqual({ status: 400, error: 'Please review the current Terms and Privacy Policy', code: 'consent_outdated' });
});

test('no configured policy version makes account creation unavailable', () => {
  delete process.env.CONSENT_VERSION;
  expect(consentError({ consentAcceptedAt: at(-HOUR), consentVersion: '2026-09' }, NOW))
    .toEqual({ status: 503, error: 'Account creation is temporarily unavailable', code: 'signup_unavailable' });
});
