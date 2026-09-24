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
