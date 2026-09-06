// The module reads process.env at import time, so each case needs a fresh registry.
function loadConsent(env) {
  jest.resetModules();
  process.env.EXPO_PUBLIC_TERMS_URL = env.terms;
  process.env.EXPO_PUBLIC_PRIVACY_URL = env.privacy;
  process.env.EXPO_PUBLIC_CONSENT_VERSION = env.version;
  return require('./consent');
}

const FULL = { terms: 'https://x.test/terms', privacy: 'https://x.test/privacy', version: 'v1' };

afterEach(() => {
  delete process.env.EXPO_PUBLIC_TERMS_URL;
  delete process.env.EXPO_PUBLIC_PRIVACY_URL;
  delete process.env.EXPO_PUBLIC_CONSENT_VERSION;
});

test('nothing is missing when all three are configured', () => {
  const { missingLegalConfig, LEGAL_READY } = loadConsent(FULL);
  expect(missingLegalConfig()).toEqual([]);
  expect(LEGAL_READY).toBe(true);
});

test('names the consent version — LEGAL_READY needs it, and the old copy never said so', () => {
  const { missingLegalConfig, LEGAL_READY } = loadConsent({ ...FULL, version: '' });
  expect(missingLegalConfig()).toEqual(['consent version']);
  expect(LEGAL_READY).toBe(false);
});

test('names a missing link', () => {
  const { missingLegalConfig } = loadConsent({ ...FULL, privacy: '' });
  expect(missingLegalConfig()).toEqual(['Privacy link']);
});

test('rejects a non-https link and names it', () => {
  const { missingLegalConfig } = loadConsent({ ...FULL, terms: 'http://x.test/terms' });
  expect(missingLegalConfig()).toEqual(['Terms link']);
});

test('names every missing piece at once', () => {
  const { missingLegalConfig } = loadConsent({ terms: '', privacy: '', version: '' });
  expect(missingLegalConfig()).toEqual(['Terms link', 'Privacy link', 'consent version']);
});

test('consentParams returns null when anything is missing', () => {
  expect(loadConsent({ ...FULL, version: '' }).consentParams()).toBeNull();
  expect(loadConsent(FULL).consentParams()).toMatchObject({ consentVersion: 'v1' });
});
