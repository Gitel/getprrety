import {
  resolveLanguage, bootLanguage, applyAccountLanguage, saveLanguage,
  retryPendingLanguage, clearPendingOnLogout, DEVICE_KEY, PENDING_KEY,
} from './languageSync';

// The real modules import Capacitor / i18next / fetch; every test injects fakes instead.
jest.mock('@capacitor/preferences', () => ({ Preferences: {} }));
jest.mock('./api', () => ({ api: {} }));
jest.mock('./i18n', () => ({ __esModule: true, default: { language: 'en', changeLanguage: jest.fn() } }));

// In-memory stand-in for Capacitor Preferences. `failReads` simulates broken storage.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  const storage = {
    data,
    failReads: false,
    get: jest.fn(async key => {
      if (storage.failReads) throw new Error('storage down');
      return data[key] ?? null;
    }),
    set: jest.fn(async (key, value) => { data[key] = value; }),
    remove: jest.fn(async key => { delete data[key]; }),
  };
  return storage;
}

function fakeI18n(language = 'en') {
  const i18n = { language, changeLanguage: jest.fn(async lng => { i18n.language = lng; }) };
  return i18n;
}

// `patch` may be set to reject (offline) or resolve.
function fakeApi(impl = async () => ({})) {
  return { patch: jest.fn(impl) };
}

const offline = async () => { const e = new TypeError('Failed to fetch'); e.code = 'network'; throw e; };
const session = user => async () => ({ user, analysis: null });
// Lets fire-and-forget promises settle.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup({ stored = {}, language = 'en', patch } = {}) {
  const storage = fakeStorage(stored);
  const i18n = fakeI18n(language);
  const api = fakeApi(patch);
  // getToken defaults to 'a token is stored'; boot tests override it.
  const getToken = jest.fn(async () => 'tok');
  return { storage, i18n, api, getToken, deps: { storage, i18n, api, getToken } };
}

describe('resolveLanguage - pending ?? account ?? device ?? en', () => {
  test('precedence', () => {
    expect(resolveLanguage({ pending: 'he', account: 'en', device: 'en' })).toBe('he');
    expect(resolveLanguage({ account: 'he', device: 'en' })).toBe('he');
    expect(resolveLanguage({ device: 'he' })).toBe('he');
    expect(resolveLanguage({})).toBe('en');
    expect(resolveLanguage()).toBe('en');
  });
  test('invalid values are skipped, not blocking', () => {
    expect(resolveLanguage({ pending: 'fr', account: 'he', device: 'en' })).toBe('he');
    expect(resolveLanguage({ pending: 5, account: null, device: 'xx' })).toBe('en');
    expect(resolveLanguage({ account: 'fr', device: 'he' })).toBe('he');
  });
});

describe('bootLanguage', () => {
  test('nothing stored, no user: stays English', async () => {
    const { deps, i18n } = setup();
    await bootLanguage(session(null), deps);
    expect(i18n.language).toBe('en');
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  test('signed out: device language', async () => {
    const { deps, i18n } = setup({ stored: { [DEVICE_KEY]: 'he' } });
    await bootLanguage(session(null), deps);
    expect(i18n.language).toBe('he');
  });

  test('signed out ignores a leftover pending value', async () => {
    const { deps, i18n, api } = setup({ stored: { [DEVICE_KEY]: 'en', [PENDING_KEY]: 'he' } });
    await bootLanguage(session(null), deps);
    expect(i18n.language).toBe('en');
    expect(api.patch).not.toHaveBeenCalled();
  });

  test('account language wins over device when nothing is pending', async () => {
    const { deps, i18n, storage, api } = setup({ stored: { [DEVICE_KEY]: 'en' } });
    const result = await bootLanguage(session({ language: 'he' }), deps);
    expect(i18n.language).toBe('he');
    expect(result.user.language).toBe('he'); // the session result is returned unchanged
    expect(storage.data[DEVICE_KEY]).toBe('en'); // applying never writes the device key
    expect(api.patch).not.toHaveBeenCalled();
  });

  test('user without a language: device language, nothing PATCHed', async () => {
    const { deps, i18n, api } = setup({ stored: { [DEVICE_KEY]: 'he' } });
    await bootLanguage(session({ language: null }), deps);
    expect(i18n.language).toBe('he');
    expect(api.patch).not.toHaveBeenCalled();
  });

  test('storage read failure does not break boot', async () => {
    const { deps, i18n, storage } = setup();
    storage.failReads = true;
    const result = await bootLanguage(session({ language: 'he' }), deps);
    expect(result.user).toEqual({ language: 'he' });
    expect(i18n.language).toBe('he');
  });

  test('a loadSession failure still propagates (unchanged auth behaviour)', async () => {
    const { deps } = setup();
    await expect(bootLanguage(async () => { throw new Error('x'); }, deps)).rejects.toThrow('x');
  });
});

describe('offline switch', () => {
  test('PATCH fails -> pending stays -> next boot uses pending and retries -> success clears it', async () => {
    const first = setup({ language: 'en', patch: offline });
    await saveLanguage('he', first.deps);
    await flush();
    expect(first.i18n.language).toBe('he');
    expect(first.storage.data[DEVICE_KEY]).toBe('he');
    expect(first.storage.data[PENDING_KEY]).toBe('he'); // kept: the save failed

    // App restarts: same storage, fresh i18n, server still has the old language.
    const second = setup({ stored: { ...first.storage.data }, language: 'en' });
    await bootLanguage(session({ language: 'en' }), second.deps);
    expect(second.i18n.language).toBe('he'); // pending beats the account
    await flush();
    expect(second.api.patch).toHaveBeenCalledWith('/api/profile', { language: 'he' });
    expect(second.storage.data[PENDING_KEY]).toBeUndefined(); // success clears it
    expect(second.storage.data[DEVICE_KEY]).toBe('he');
  });

  test('successful save clears pending right away', async () => {
    const { deps, storage, api } = setup();
    await saveLanguage('he', deps);
    await flush();
    expect(api.patch).toHaveBeenCalledWith('/api/profile', { language: 'he' });
    expect(storage.data[PENDING_KEY]).toBeUndefined();
    expect(storage.data[DEVICE_KEY]).toBe('he');
  });

  test('a newer choice is not cleared by an older save finishing', async () => {
    const finishers = [];
    const { deps, storage } = setup({ patch: () => new Promise(res => { finishers.push(res); }) });
    await saveLanguage('he', deps); // first PATCH stays in flight
    await saveLanguage('en', deps); // user switches back; second PATCH also in flight
    finishers[0]({}); // the older 'he' save finishes
    await flush();
    expect(storage.data[PENDING_KEY]).toBe('en'); // the 'he' save must not remove the 'en' marker
  });
});

describe('saveLanguage', () => {
  test('never throws, even with broken storage and api', async () => {
    const { deps, storage, api, i18n } = setup({ patch: offline });
    storage.set.mockRejectedValue(new Error('disk'));
    storage.get.mockRejectedValue(new Error('disk'));
    await expect(saveLanguage('he', deps)).resolves.toBe(true);
    await flush();
    expect(i18n.language).toBe('he');
    expect(api.patch).toHaveBeenCalled();
  });

  test('does not wait for the PATCH', async () => {
    const { deps } = setup({ patch: () => new Promise(() => {}) }); // never settles
    await expect(saveLanguage('he', deps)).resolves.toBe(true);
  });

  test('ignores an unsupported language', async () => {
    const { deps, api, storage } = setup();
    await expect(saveLanguage('fr', deps)).resolves.toBe(false);
    expect(api.patch).not.toHaveBeenCalled();
    expect(storage.data[DEVICE_KEY]).toBeUndefined();
  });
});

describe('resume retry', () => {
  test('retries pending but never changes the UI language', async () => {
    const { deps, i18n, api, storage } = setup({ stored: { [PENDING_KEY]: 'he', [DEVICE_KEY]: 'he' }, language: 'en' });
    await retryPendingLanguage(deps);
    expect(api.patch).toHaveBeenCalledWith('/api/profile', { language: 'he' });
    expect(storage.data[PENDING_KEY]).toBeUndefined();
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(i18n.language).toBe('en');
  });

  test('failed retry keeps pending for the next resume', async () => {
    const { deps, storage } = setup({ stored: { [PENDING_KEY]: 'he' }, patch: offline });
    await retryPendingLanguage(deps);
    expect(storage.data[PENDING_KEY]).toBe('he');
  });

  test('nothing pending: no request', async () => {
    const { deps, api } = setup({ stored: { [DEVICE_KEY]: 'he' } });
    await retryPendingLanguage(deps);
    expect(api.patch).not.toHaveBeenCalled();
  });

  test('storage failure does not reject', async () => {
    const { deps, storage } = setup({ stored: { [PENDING_KEY]: 'he' } });
    storage.failReads = true;
    await expect(retryPendingLanguage(deps)).resolves.toBe(false);
  });

  test('two overlapping retries send one request', async () => {
    const { deps, api } = setup({ stored: { [PENDING_KEY]: 'he' } });
    await Promise.all([retryPendingLanguage(deps), retryPendingLanguage(deps)]);
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});

describe('sign-in', () => {
  test('account language wins over device when nothing is pending', async () => {
    const { deps, i18n, storage } = setup({ stored: { [DEVICE_KEY]: 'en' } });
    await expect(applyAccountLanguage({ language: 'he' }, deps)).resolves.toBe('he');
    expect(i18n.language).toBe('he');
    expect(storage.data[DEVICE_KEY]).toBe('en');
  });

  test('pending wins over the account', async () => {
    const { deps, i18n } = setup({ stored: { [PENDING_KEY]: 'he' } });
    await applyAccountLanguage({ language: 'en' }, deps);
    expect(i18n.language).toBe('he');
  });

  test('a user who never chose a language stays English', async () => {
    const { deps, i18n } = setup();
    await applyAccountLanguage({ language: null }, deps);
    expect(i18n.language).toBe('en');
  });
});

describe('shared device', () => {
  test('logout clears pending; next account with no language gets the device language and nothing is PATCHed', async () => {
    // Person A chose Hebrew offline: device=he, pending=he.
    const { deps, i18n, storage, api } = setup({ stored: { [DEVICE_KEY]: 'he', [PENDING_KEY]: 'he' }, language: 'he' });
    await clearPendingOnLogout(deps);
    expect(storage.data[PENDING_KEY]).toBeUndefined();
    expect(storage.data[DEVICE_KEY]).toBe('he');
    expect(i18n.language).toBe('he'); // signed-out UI = device language

    // Person B signs in; their account has no language.
    await applyAccountLanguage({ language: null }, deps);
    expect(i18n.language).toBe('he');
    await retryPendingLanguage(deps); // what the next resume would do
    expect(api.patch).not.toHaveBeenCalled();
  });

  test('logout with no device language shows English', async () => {
    const { deps, i18n } = setup({ stored: { [PENDING_KEY]: 'he' }, language: 'he' });
    await clearPendingOnLogout(deps);
    expect(i18n.language).toBe('en');
  });

  test('logout survives broken storage', async () => {
    const { deps, storage } = setup();
    storage.remove.mockRejectedValue(new Error('x'));
    storage.failReads = true;
    await expect(clearPendingOnLogout(deps)).resolves.toBeUndefined();
  });
});

describe('boot with a revoked token (shared device)', () => {
  test('token removed by loadSession: pending is cleared, the next account does not inherit it', async () => {
    const { deps, storage, api, i18n, getToken } = setup({ stored: { [DEVICE_KEY]: 'en', [PENDING_KEY]: 'he' } });
    getToken.mockResolvedValue(null); // loadSession removed the token after a 401/404
    await bootLanguage(session(null), deps);
    expect(storage.data[PENDING_KEY]).toBeUndefined();
    expect(storage.data[DEVICE_KEY]).toBe('en');

    // Another person signs in; their account has language en.
    await applyAccountLanguage({ language: 'en' }, deps);
    expect(i18n.language).toBe('en');
    await retryPendingLanguage(deps);
    await flush();
    expect(api.patch).not.toHaveBeenCalled();
  });

  test('offline boot (token still stored, no user): pending is kept', async () => {
    const { deps, storage } = setup({ stored: { [PENDING_KEY]: 'he' } });
    await bootLanguage(session(null), deps); // getToken still returns a token
    expect(storage.data[PENDING_KEY]).toBe('he');
  });

  test('an unreadable token keeps pending', async () => {
    const { deps, storage, getToken } = setup({ stored: { [PENDING_KEY]: 'he' } });
    getToken.mockRejectedValue(new Error('x'));
    await bootLanguage(session(null), deps);
    expect(storage.data[PENDING_KEY]).toBe('he');
  });
});

describe('PATCH ordering', () => {
  test('he then en quickly: the last PATCH sent is en and pending is cleared', async () => {
    const { deps, api, storage } = setup();
    await saveLanguage('he', deps);
    await saveLanguage('en', deps);
    await flush();
    const sent = api.patch.mock.calls.map(c => c[1].language);
    expect(sent[sent.length - 1]).toBe('en');
    expect(storage.data[PENDING_KEY]).toBeUndefined();
  });

  test('a slow first PATCH finishing after the second was requested does not leave the account on the old value', async () => {
    const release = [];
    const sent = [];
    const { deps, storage } = setup({
      patch: (path, body) => new Promise(res => { sent.push(body.language); release.push(res); }),
    });
    await saveLanguage('he', deps); // PATCH he in flight (slow)
    await saveLanguage('en', deps); // must wait: nothing sent in parallel
    await flush();
    expect(sent).toEqual(['he']);
    release[0]({}); // he finishes; the account is on he, but the choice is now en
    await flush();
    expect(sent).toEqual(['he', 'en']); // en is sent after he, never before
    expect(storage.data[PENDING_KEY]).toBe('en'); // not cleared until en is saved
    release[1]({});
    await flush();
    expect(storage.data[PENDING_KEY]).toBeUndefined();
    expect(sent[sent.length - 1]).toBe('en');
  });

  test('a failed PATCH in the chain keeps pending and does not block the next one', async () => {
    let n = 0;
    const { deps, storage, api } = setup({ patch: async () => { n += 1; if (n === 1) throw new Error('down'); return {}; } });
    await saveLanguage('he', deps);
    await flush();
    expect(storage.data[PENDING_KEY]).toBe('he');
    await saveLanguage('en', deps);
    await flush();
    expect(api.patch).toHaveBeenLastCalledWith('/api/profile', { language: 'en' });
    expect(storage.data[PENDING_KEY]).toBeUndefined();
  });
});
