import i18n from './i18n';
import { errorText } from './errorText';

const enCodes = require('../locales/en/errors.json');
const heCodes = require('../locales/he/errors.json');

// Every code the server (and this client) may produce.
const CODES = [
  'too_many_attempts', 'email_password_required', 'password_too_short', 'invalid_email',
  'email_taken', 'signup_failed', 'google_token_required', 'google_unavailable',
  'google_token_invalid', 'google_email_unverified', 'google_signin_failed',
  'invalid_credentials', 'login_failed', 'user_not_found', 'account_load_failed',
  'signup_unavailable', 'consent_required', 'consent_outdated', 'auth_required',
  'auth_invalid', 'profile_load_failed', 'profile_update_failed', 'invalid_language',
  'message_empty', 'message_too_long', 'account_not_found', 'message_rate_limited',
  'messages_load_failed', 'messages_update_failed', 'message_send_failed',
  'timeout', 'network', 'server_error', 'generic',
];

const t = (...args) => i18n.t(...args);

afterEach(() => i18n.changeLanguage('en'));

test('every code exists in both en and he', () => {
  for (const code of CODES) {
    expect(enCodes[code]).toBeTruthy();
    expect(heCodes[code]).toBeTruthy();
  }
});

test('known code -> translated text (en and he)', () => {
  const err = { code: 'invalid_credentials', status: 401, message: 'Invalid email or password' };
  expect(errorText(err, t)).toBe(enCodes.invalid_credentials);
  i18n.changeLanguage('he');
  expect(errorText(err, t)).toBe(heCodes.invalid_credentials);
});

test('params are interpolated', () => {
  const err = { code: 'password_too_short', params: { min: 8 } };
  expect(errorText(err, t)).toBe('Password must be at least 8 characters');
  i18n.changeLanguage('he');
  expect(errorText(err, t)).toContain('8');
});

test('unknown code -> generic fallback, not the key', () => {
  expect(errorText({ code: 'brand_new_code', status: 400 }, t)).toBe(enCodes.generic);
});

test('code with bad characters -> fallback', () => {
  expect(errorText({ code: 'a:b', status: 400 }, t)).toBe(enCodes.generic);
  expect(errorText({ code: '../x', status: 400 }, t)).toBe(enCodes.generic);
  expect(errorText({ code: 42, status: 400 }, t)).toBe(enCodes.generic);
});

test('5xx without a code -> server_error', () => {
  expect(errorText({ status: 503 }, t)).toBe(enCodes.server_error);
});

test('4xx without a code -> fallback', () => {
  expect(errorText({ status: 400 }, t)).toBe(enCodes.generic);
});

test('custom fallbackKey is used', () => {
  expect(errorText({ status: 400 }, t, 'errors:login_failed')).toBe(enCodes.login_failed);
});

test('never returns the server English text', () => {
  const err = { status: 400, message: 'Some raw server sentence' };
  expect(errorText(err, t)).not.toContain('raw server sentence');
  i18n.changeLanguage('he');
  expect(errorText(err, t)).toBe(heCodes.generic);
});

test('works with a missing error object', () => {
  expect(errorText(undefined, t)).toBe(enCodes.generic);
});
