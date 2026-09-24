const { parseProfileForm, updateUserProfile } = require('./adminEdits');

const ID = '64b0000000000000000000aa';

function fakeUserModel(current, updateImpl) {
  return {
    findById: jest.fn(() => ({ select: () => ({ lean: async () => current }) })),
    findByIdAndUpdate: jest.fn(updateImpl || (async () => ({}))),
  };
}

describe('parseProfileForm', () => {
  test('normalizes a valid form and turns empty optionals into null', () => {
    expect(parseProfileForm({ firstName: ' Ada ', email: ' Ada@Example.COM ', skincareTiming: '', city: '', country: 'il' }))
      .toEqual({ updates: { firstName: 'Ada', email: 'ada@example.com', skincareTiming: null, city: null, country: 'IL' } });
  });

  test.each([
    [{ email: 'nope' }, 'profile_invalid_email'],
    [{}, 'profile_invalid_email'],
    [{ email: 'a@b.co', skincareTiming: 'noon' }, 'profile_invalid_timing'],
    [{ email: 'a@b.co', country: 'Israel' }, 'profile_invalid_country'],
    [{ email: 'a@b.co', country: '1L' }, 'profile_invalid_country'],
  ])('rejects %p with %s', (body, code) => {
    expect(parseProfileForm(body)).toEqual({ error: code });
  });
});

describe('updateUserProfile', () => {
  const current = { firstName: 'Ada', email: 'ada@example.com', skincareTiming: 'both', city: null, country: null };

  test('writes only the changed fields with one $set and reports them', async () => {
    const model = fakeUserModel(current);
    const result = await updateUserProfile(ID, { firstName: 'Ada', email: 'ada@example.com', skincareTiming: 'night', city: 'Haifa', country: '' }, { userModel: model });
    expect(result).toEqual({ ok: true, changed: ['skincareTiming', 'city'] });
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(ID, { $set: { skincareTiming: 'night', city: 'Haifa' } }, { runValidators: true });
  });

  test('an unchanged form writes nothing', async () => {
    const model = fakeUserModel(current);
    const result = await updateUserProfile(ID, { ...current, skincareTiming: 'both' }, { userModel: model });
    expect(result).toEqual({ ok: true, changed: [] });
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('an email already used by another account is a friendly error', async () => {
    const dup = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } });
    const model = fakeUserModel(current, async () => { throw dup; });
    await expect(updateUserProfile(ID, { ...current, email: 'taken@example.com' }, { userModel: model }))
      .resolves.toEqual({ ok: false, code: 'profile_email_taken' });
  });

  test('any other database error is rethrown', async () => {
    const model = fakeUserModel(current, async () => { throw new Error('mongo down'); });
    await expect(updateUserProfile(ID, { ...current, email: 'new@example.com' }, { userModel: model })).rejects.toThrow('mongo down');
  });

  test('unknown or malformed user ids are notfound; invalid forms never read the DB', async () => {
    await expect(updateUserProfile(ID, current, { userModel: fakeUserModel(null) })).resolves.toEqual({ ok: false, code: 'user_notfound' });
    await expect(updateUserProfile('x', current, { userModel: fakeUserModel(current) })).resolves.toEqual({ ok: false, code: 'user_notfound' });
    const model = fakeUserModel(current);
    await expect(updateUserProfile(ID, { email: 'bad' }, { userModel: model })).resolves.toEqual({ ok: false, code: 'profile_invalid_email' });
    expect(model.findById).not.toHaveBeenCalled();
  });
});

describe('updateAnalysisSection', () => {
  const AID = '64b000000000000000000001';
  const { updateAnalysisSection } = require('./adminEdits');

  function fakeAnalysisModel(current) {
    return {
      findById: jest.fn(() => ({ select: () => ({ lean: async () => current }) })),
      findByIdAndUpdate: jest.fn(async () => ({})),
    };
  }

  const stored = {
    userId: 'u1',
    eraId: 'barrier_healing',
    skinAnalysis: 'Old text',
    keyInsights: ['One'],
    affirmation: 'I glow',
  };

  test('fields: changing the era writes eraId AND the complete era object', async () => {
    const model = fakeAnalysisModel(stored);
    const result = await updateAnalysisSection(AID, 'fields', {
      eraId: 'glow_building', skinAnalysis: 'Old text', keyInsights: ['One', ' '], affirmation: 'I glow',
    }, { analysisModel: model });
    expect(result).toEqual({ ok: true, changed: ['eraId', 'era'], action: 'analysis_fields_updated', userId: 'u1' });
    const { $set } = model.findByIdAndUpdate.mock.calls[0][1];
    expect($set.era).toMatchObject({ id: 'glow_building', name: 'Glow Building Era', color: '#B8924A', bg: '#FBF6EE', emoji: expect.any(String) });
  });

  test('fields: same era, new text writes only the text fields that changed', async () => {
    const model = fakeAnalysisModel(stored);
    const result = await updateAnalysisSection(AID, 'fields', {
      eraId: 'barrier_healing', skinAnalysis: ' New text ', keyInsights: ['One', 'Two'], affirmation: 'I glow',
    }, { analysisModel: model });
    expect(result.changed).toEqual(['skinAnalysis', 'keyInsights']);
    expect(model.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $set: { skinAnalysis: 'New text', keyInsights: ['One', 'Two'] } });
  });

  test('fields: an unchanged form writes nothing', async () => {
    const model = fakeAnalysisModel(stored);
    const result = await updateAnalysisSection(AID, 'fields', { ...stored }, { analysisModel: model });
    expect(result.changed).toEqual([]);
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('fields: an era outside the fixed list is rejected (the app would crash on it)', async () => {
    const model = fakeAnalysisModel(stored);
    await expect(updateAnalysisSection(AID, 'fields', { eraId: 'made_up' }, { analysisModel: model }))
      .resolves.toEqual({ ok: false, code: 'analysis_invalid_era' });
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('unknown or malformed analysis ids are notfound', async () => {
    await expect(updateAnalysisSection(AID, 'fields', {}, { analysisModel: fakeAnalysisModel(null) }))
      .resolves.toEqual({ ok: false, code: 'analysis_notfound' });
    await expect(updateAnalysisSection('x', 'fields', {}, { analysisModel: fakeAnalysisModel(stored) }))
      .resolves.toEqual({ ok: false, code: 'analysis_notfound' });
  });

  test('an unknown section name is a programming error', async () => {
    await expect(updateAnalysisSection(AID, 'nope', {}, { analysisModel: fakeAnalysisModel(stored) })).rejects.toThrow('Unknown analysis section');
  });
});
