const { saveAnalysis } = require('./saveAnalysis');

const duplicateKeyError = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

function fakeModel({ createImpl, findOneImpl } = {}) {
  return {
    create: jest.fn(createImpl || (async fields => ({ _id: 'new', ...fields }))),
    findOne: jest.fn(findOneImpl || (async () => null)),
  };
}

test('creates the analysis and reports it as new', async () => {
  const model = fakeModel();
  const { doc, created } = await saveAnalysis({ userId: 'u1', eraId: 'glow', clientRequestId: 'req-1' }, { model });

  expect(created).toBe(true);
  expect(doc).toMatchObject({ userId: 'u1', eraId: 'glow' });
  expect(model.create).toHaveBeenCalledTimes(1);
});

test('a retry of an already-stored request returns the original and reports created:false', async () => {
  const existing = { _id: 'orig', userId: 'u1', clientRequestId: 'req-1' };
  const model = fakeModel({
    createImpl: async () => { throw duplicateKeyError(); },
    findOneImpl: async () => existing,
  });

  const { doc, created } = await saveAnalysis({ userId: 'u1', clientRequestId: 'req-1' }, { model });

  expect(created).toBe(false);
  expect(doc).toBe(existing);
  expect(model.findOne).toHaveBeenCalledWith({ userId: 'u1', clientRequestId: 'req-1' });
});

test('rethrows a duplicate-key error when there is no request id to recover by', async () => {
  const model = fakeModel({ createImpl: async () => { throw duplicateKeyError(); } });
  await expect(saveAnalysis({ userId: 'u1', clientRequestId: null }, { model })).rejects.toThrow('E11000');
  expect(model.findOne).not.toHaveBeenCalled();
});

test('rethrows when the duplicate cannot be found — never silently drops a save', async () => {
  const model = fakeModel({
    createImpl: async () => { throw duplicateKeyError(); },
    findOneImpl: async () => null,
  });
  await expect(saveAnalysis({ userId: 'u1', clientRequestId: 'req-1' }, { model })).rejects.toThrow('E11000');
});

test('rethrows non-duplicate errors untouched', async () => {
  const model = fakeModel({ createImpl: async () => { throw new Error('validation failed'); } });
  await expect(saveAnalysis({ userId: 'u1', clientRequestId: 'req-1' }, { model })).rejects.toThrow('validation failed');
  expect(model.findOne).not.toHaveBeenCalled();
});
