const {
  KEYS, getActiveConfig, buildSystem, parseConfigForm, saveVersion, listVersions, restoreVersion,
} = require('./aiConfig');
const { DEFAULTS } = require('./defaults');

const ID_A = '64b0000000000000000000aa';
const ID_B = '64b0000000000000000000bb';
const GOOD = { guidance: 'Be kind.', timeoutSec: '60', maxOutputTokens: '4000', maxCostUsd: '0.20', note: 'tone' };

// Fake model. findOne(...) is either the live-config query (.sort().maxTimeMS().lean()) or the
// restore lookup (.lean()), so the returned query object supports both chains.
function fakeModel({ live = null, byId = null, rejectWith = null } = {}) {
  const query = result => {
    const promise = rejectWith ? Promise.reject(rejectWith) : Promise.resolve(result);
    promise.catch(() => {}); // avoid unhandled-rejection noise; the caller awaits it
    const q = { sort: jest.fn(() => q), maxTimeMS: jest.fn(() => q), limit: jest.fn(() => q), lean: jest.fn(() => promise) };
    return q;
  };
  return {
    findOne: jest.fn(filter => query(filter._id ? byId : live)),
    find: jest.fn(() => query([{ _id: ID_B, guidance: 'g', limits: { timeoutSec: 30 }, note: 'n', createdBy: 'a@b.c', createdAt: new Date(0) }])),
    create: jest.fn(async doc => ({ _id: ID_A, ...doc })),
  };
}

const savedDoc = (extra = {}) => ({
  _id: ID_A, key: 'market_picks', guidance: 'Saved guidance', createdBy: 'admin@example.test', createdAt: new Date('2026-10-01T00:00:00Z'),
  limits: { timeoutSec: 45, maxOutputTokens: 700, maxCostUsd: 0.15 }, ...extra,
});

describe('getActiveConfig', () => {
  test('no saved version -> the built-in defaults', async () => {
    const model = fakeModel();
    const config = await getActiveConfig('skin_analysis', { model });
    expect(config).toEqual({
      guidance: DEFAULTS.skin_analysis.defaultGuidance, limits: { timeoutSec: 90, maxOutputTokens: 8000, maxCostUsd: 0.25 },
      versionId: null, source: 'default', savedBy: null, savedAt: null,
    });
    expect(model.findOne).toHaveBeenCalledWith({ key: 'skin_analysis' });
    const q = model.findOne.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(q.maxTimeMS).toHaveBeenCalledWith(2000);
  });

  test('a saved version is returned with who / when', async () => {
    const config = await getActiveConfig('market_picks', { model: fakeModel({ live: savedDoc() }) });
    expect(config).toEqual({
      guidance: 'Saved guidance', limits: { timeoutSec: 45, maxOutputTokens: 700, maxCostUsd: 0.15 },
      versionId: ID_A, source: 'saved', savedBy: 'admin@example.test', savedAt: new Date('2026-10-01T00:00:00Z'),
    });
  });

  test('saved guidance may be empty (it is not replaced by the default)', async () => {
    const config = await getActiveConfig('market_picks', { model: fakeModel({ live: savedDoc({ guidance: '' }) }) });
    expect(config.guidance).toBe('');
    expect(config.source).toBe('saved');
  });

  test('an out-of-range stored limit falls back to the default for that field only', async () => {
    const live = savedDoc({ limits: { timeoutSec: 5, maxOutputTokens: 700, maxCostUsd: 9 } });
    const config = await getActiveConfig('market_picks', { model: fakeModel({ live }) });
    expect(config.limits).toEqual({ timeoutSec: 90, maxOutputTokens: 700, maxCostUsd: 0.25 });
  });

  test('ANY error -> defaults plus a warning, never a throw (P6)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const config = await getActiveConfig('score_reading', { model: fakeModel({ rejectWith: new Error('mongo down') }) });
      expect(config.source).toBe('default');
      expect(config.guidance).toBe(DEFAULTS.score_reading.defaultGuidance);
      expect(config.limits).toEqual(DEFAULTS.score_reading.defaultLimits);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('score_reading'));
    } finally { warn.mockRestore(); }
  });

  test('a model that throws synchronously also falls back to the defaults', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const model = { findOne: () => { throw new Error('boom'); } };
      expect((await getActiveConfig('market_picks', { model })).source).toBe('default');
    } finally { warn.mockRestore(); }
  });

  test('a read that never answers gives up after the timeout and returns the defaults', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const q = { sort: () => q, maxTimeMS: () => q, lean: () => new Promise(() => {}) };
      const pending = getActiveConfig('market_picks', { model: { findOne: () => q } });
      await jest.advanceTimersByTimeAsync(2600);
      expect((await pending).source).toBe('default');
    } finally { warn.mockRestore(); jest.useRealTimers(); }
  });

  test('an unknown key is a programming error and throws', async () => {
    await expect(getActiveConfig('nope', { model: fakeModel() })).rejects.toThrow('Unknown AI config key');
  });
});

describe('buildSystem', () => {
  test('delegates to the shared assembly', () => {
    expect(buildSystem('market_picks', 'X')).toContain('Clinic guidance:\nX');
    expect(buildSystem('score_reading', '', 'he')).toContain('Hebrew');
    expect(KEYS).toEqual(['skin_analysis', 'score_reading', 'market_picks']);
  });
});

describe('parseConfigForm bounds', () => {
  const parse = override => parseConfigForm({ ...GOOD, ...override });
  const errorFields = result => Object.keys(result.errors || {});

  test('accepts a valid form (strings from a browser) and returns typed values', () => {
    expect(parse({})).toEqual({ ok: true, values: { guidance: 'Be kind.', timeoutSec: 60, maxOutputTokens: 4000, maxCostUsd: 0.2, note: 'tone' } });
  });

  test('accepts JSON numbers as well', () => {
    expect(parseConfigForm({ guidance: '', timeoutSec: 20, maxOutputTokens: 500, maxCostUsd: 0.05 }).ok).toBe(true);
  });

  test.each([['19', false], ['20', true], ['90', true], ['91', false], ['60.5', false], ['abc', false], ['', false]])(
    'timeoutSec %p -> ok %p', (value, ok) => {
      const result = parse({ timeoutSec: value });
      expect(result.ok).toBe(ok);
      if (!ok) expect(errorFields(result)).toEqual(['timeoutSec']);
    });

  test.each([['499', false], ['500', true], ['8000', true], ['8001', false], ['1000.5', false]])(
    'maxOutputTokens %p -> ok %p', (value, ok) => {
      const result = parse({ maxOutputTokens: value });
      expect(result.ok).toBe(ok);
      if (!ok) expect(errorFields(result)).toEqual(['maxOutputTokens']);
    });

  test.each([['0.04', false], ['0.05', true], ['0.5', true], ['0.50', true], ['0.51', false], ['0.123', false], ['0.25', true], ['0.1', true]])(
    'maxCostUsd %p -> ok %p', (value, ok) => {
      const result = parse({ maxCostUsd: value });
      expect(result.ok).toBe(ok);
      if (!ok) expect(errorFields(result)).toEqual(['maxCostUsd']);
    });

  test('maxCostUsd with float noise (0.07 etc.) is stored as exactly 2 decimals', () => {
    expect(parse({ maxCostUsd: 0.07 }).values.maxCostUsd).toBe(0.07);
    expect(parse({ maxCostUsd: '0.29' }).values.maxCostUsd).toBe(0.29);
  });

  test('guidance: up to 8000 characters, may be empty, must be a string', () => {
    expect(parse({ guidance: 'x'.repeat(8000) }).ok).toBe(true);
    expect(errorFields(parse({ guidance: 'x'.repeat(8001) }))).toEqual(['guidance']);
    expect(parse({ guidance: '' }).values.guidance).toBe('');
    for (const bad of [5, ['a'], { a: 1 }, true]) expect(errorFields(parse({ guidance: bad }))).toEqual(['guidance']);
  });

  test('guidance line breaks are normalised to LF so a browser round trip compares equal', () => {
    expect(parse({ guidance: 'a\r\nb  ' }).values.guidance).toBe('a\nb');
  });

  test('note: up to 200 characters', () => {
    expect(parse({ note: 'n'.repeat(200) }).ok).toBe(true);
    expect(errorFields(parse({ note: 'n'.repeat(201) }))).toEqual(['note']);
  });

  test('every bad field is reported at once and non-object bodies are rejected', () => {
    const result = parseConfigForm({ guidance: 1, timeoutSec: 1, maxOutputTokens: 1, maxCostUsd: 1, note: 'n'.repeat(300) });
    expect(errorFields(result).sort()).toEqual(['guidance', 'maxCostUsd', 'maxOutputTokens', 'note', 'timeoutSec']);
    expect(parseConfigForm(null).ok).toBe(false);
    expect(parseConfigForm(undefined).ok).toBe(false);
  });
});

describe('saveVersion', () => {
  const values = parseConfigForm(GOOD).values;

  test('inserts a new version stamped with the admin email when something changed', async () => {
    const model = fakeModel();
    const result = await saveVersion('market_picks', values, 'admin@example.test', { model });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(model.create).toHaveBeenCalledWith({
      key: 'market_picks', guidance: 'Be kind.', limits: { timeoutSec: 60, maxOutputTokens: 4000, maxCostUsd: 0.2 },
      note: 'tone', createdBy: 'admin@example.test', restoredFrom: null,
    });
    expect(result.version.createdBy).toBe('admin@example.test');
  });

  test('identical to the live saved config -> changed:false and nothing inserted', async () => {
    const live = savedDoc({ guidance: 'Be kind.', limits: { timeoutSec: 60, maxOutputTokens: 4000, maxCostUsd: 0.2 } });
    const model = fakeModel({ live });
    expect(await saveVersion('market_picks', { ...values, note: 'a different note' }, 'a@b.c', { model })).toEqual({ ok: true, changed: false });
    expect(model.create).not.toHaveBeenCalled();
  });

  test('identical to the built-in default (nothing saved yet) -> changed:false', async () => {
    const def = DEFAULTS.market_picks;
    const model = fakeModel();
    const same = { guidance: def.defaultGuidance, ...def.defaultLimits, note: '' };
    expect(await saveVersion('market_picks', same, 'a@b.c', { model })).toEqual({ ok: true, changed: false });
    expect(model.create).not.toHaveBeenCalled();
  });

  test('a change in only the limits counts as changed', async () => {
    const live = savedDoc({ guidance: 'Be kind.', limits: { timeoutSec: 60, maxOutputTokens: 4000, maxCostUsd: 0.2 } });
    const model = fakeModel({ live });
    expect((await saveVersion('market_picks', { ...values, timeoutSec: 61 }, 'a@b.c', { model })).changed).toBe(true);
  });

  test('out-of-bounds values are rejected even when the caller skipped parseConfigForm', async () => {
    const model = fakeModel();
    const result = await saveVersion('market_picks', { ...values, timeoutSec: 500 }, 'a@b.c', { model });
    expect(result).toMatchObject({ ok: false, errors: { timeoutSec: expect.any(String) } });
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe('listVersions', () => {
  test('newest first, limited, as plain objects with a string id', async () => {
    const model = fakeModel();
    const list = await listVersions('market_picks', 10, { model });
    expect(model.find).toHaveBeenCalledWith({ key: 'market_picks' });
    const q = model.find.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(q.limit).toHaveBeenCalledWith(10);
    expect(list).toEqual([{ id: ID_B, guidance: 'g', limits: { timeoutSec: 30 }, note: 'n', createdBy: 'a@b.c', restoredFrom: null, createdAt: new Date(0) }]);
  });

  test('defaults to 50 rows', async () => {
    const model = fakeModel();
    await listVersions('market_picks', undefined, { model });
    expect(model.find.mock.results[0].value.limit).toHaveBeenCalledWith(50);
  });
});

describe('restoreVersion', () => {
  test('copies an older version into a NEW document with restoredFrom set', async () => {
    const old = savedDoc({ _id: ID_B });
    const model = fakeModel({ byId: old });
    const result = await restoreVersion('market_picks', ID_B, 'admin@example.test', { model });
    expect(model.findOne).toHaveBeenCalledWith({ _id: ID_B, key: 'market_picks' }); // key filter blocks other tasks' versions
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      key: 'market_picks', guidance: 'Saved guidance', limits: old.limits, createdBy: 'admin@example.test', restoredFrom: ID_B,
    }));
    expect(result).toMatchObject({ ok: true, changed: true });
  });

  test("'default' inserts a copy of the built-in default", async () => {
    const model = fakeModel();
    const result = await restoreVersion('score_reading', 'default', 'admin@example.test', { model });
    expect(model.findOne).not.toHaveBeenCalled();
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      key: 'score_reading', guidance: DEFAULTS.score_reading.defaultGuidance, limits: DEFAULTS.score_reading.defaultLimits,
      restoredFrom: 'default', createdBy: 'admin@example.test',
    }));
    expect(result.ok).toBe(true);
  });

  test('a malformed id or a version of another key -> not_found, nothing inserted', async () => {
    const model = fakeModel({ byId: null });
    for (const bad of ['nope', '', undefined, null, 5, 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
      expect(await restoreVersion('market_picks', bad, 'a@b.c', { model })).toEqual({ ok: false, code: 'not_found' });
    }
    // Well-formed id but no document for this key (e.g. it belongs to another task).
    expect(await restoreVersion('market_picks', ID_B, 'a@b.c', { model })).toEqual({ ok: false, code: 'not_found' });
    expect(model.create).not.toHaveBeenCalled();
  });
});
