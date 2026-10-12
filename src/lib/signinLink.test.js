// Sign-in link helpers (src/lib/signinLink.js). Contract: AI/plans/paid-booking-and-signin-link-contract.md section 7.
jest.mock('./api', () => ({ api: { post: jest.fn(() => Promise.resolve({ ok: true })) } }));
const { api } = require('./api');
const { readSigninToken, redeemSigninLink } = require('./signinLink');

// Minimal fake of the browser globals the helper touches (jest runs in node).
function setUrl(pathname, search, hash) {
  const replaceState = jest.fn();
  global.window = { location: { pathname, search, hash }, history: { replaceState } };
  return replaceState;
}
afterEach(() => { delete global.window; });

describe('readSigninToken', () => {
  test('returns the token and strips it, keeping path and search', () => {
    const replace = setUrl('/app', '?ref=lu_clinic', '#signin=abc123');
    expect(readSigninToken()).toBe('abc123');
    expect(replace).toHaveBeenCalledWith(null, '', '/app?ref=lu_clinic');
  });

  test('tolerates other hash params and keeps them', () => {
    const replace = setUrl('/', '', '#x=1&signin=tok_-9&y=2');
    expect(readSigninToken()).toBe('tok_-9');
    expect(replace).toHaveBeenCalledWith(null, '', '/#x=1&y=2');
  });

  test('no token -> null and the URL is untouched', () => {
    const replace = setUrl('/', '', '#other=1');
    expect(readSigninToken()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  test('empty hash or no window -> null', () => {
    setUrl('/', '', '');
    expect(readSigninToken()).toBeNull();
    delete global.window;
    expect(readSigninToken()).toBeNull();
  });

  test('an empty token is stripped but returns null', () => {
    const replace = setUrl('/', '', '#signin=');
    expect(readSigninToken()).toBeNull();
    expect(replace).toHaveBeenCalledWith(null, '', '/');
  });
});

describe('redeemSigninLink', () => {
  test('posts the token with the consent fields', async () => {
    await redeemSigninLink('t1', { consentAcceptedAt: '2026-01-01T00:00:00.000Z', consentVersion: 'v1' });
    // Third argument = api.js options; none given here, so it is undefined (api.js default timeout).
    expect(api.post).toHaveBeenCalledWith('/api/auth/link/redeem', {
      token: 't1', consentAcceptedAt: '2026-01-01T00:00:00.000Z', consentVersion: 'v1',
    }, undefined);
  });

  test('without consent only the token is sent', async () => {
    await redeemSigninLink('t2', null);
    expect(api.post).toHaveBeenLastCalledWith('/api/auth/link/redeem', { token: 't2' }, undefined);
  });

  test('passes api options through (boot uses a short timeout)', async () => {
    await redeemSigninLink('t3', null, { timeoutMs: 6000 });
    expect(api.post).toHaveBeenLastCalledWith('/api/auth/link/redeem', { token: 't3' }, { timeoutMs: 6000 });
  });
});
