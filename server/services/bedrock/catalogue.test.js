const {
  CATALOGUE_QUERY_MAX_TIME_MS, MODEL_FIELDS, loadCatalogue, loadSeedCatalogue, loadSnapshotCatalogue,
} = require('./catalogue');
const seed = require('../../data/catalogue-seed/products.json');

function makeModel(products) {
  const query = {
    lean: jest.fn(() => query),
    maxTimeMS: jest.fn(() => Promise.resolve(products)),
  };
  return { find: jest.fn(() => query), query };
}

test('loads active home-use records by Mongo ID and excludes photo bytes', async () => {
  const product = {
    _id: { toString: () => '64b000000000000000000001' },
    name: 'Current cream', category: 'face_creams', use: 'home', pregnancy: 'safe', archived: false,
    keyActives: ['Ceramides'], strengths: ['2%'], suitableFor: ['Dry skin'], ingredients: 'Water',
    photo: { data: Buffer.from('private image') },
  };
  const model = makeModel([product]);

  await expect(loadCatalogue({ model })).resolves.toEqual([{
    _id: '64b000000000000000000001', name: 'Current cream', category: 'face_creams', use: 'home',
    pregnancy: 'safe', archived: false, keyActives: ['Ceramides'], strengths: ['2%'],
    suitableFor: ['Dry skin'], ingredients: 'Water',
  }]);
  expect(model.find).toHaveBeenCalledWith({ use: 'home', archived: { $ne: true } }, MODEL_FIELDS);
  expect(model.query.lean).toHaveBeenCalledTimes(1);
  expect(model.query.maxTimeMS).toHaveBeenCalledWith(CATALOGUE_QUERY_MAX_TIME_MS);
});

test('an empty live collection stays empty and database errors propagate', async () => {
  await expect(loadCatalogue({ model: makeModel([]) })).resolves.toEqual([]);
  const error = new Error('database unavailable');
  const model = { find: () => ({ lean: () => ({ maxTimeMS: () => Promise.reject(error) }) }) };
  await expect(loadCatalogue({ model })).rejects.toBe(error);
});

test('offline seed loading is explicit and uses permanent seed keys', () => {
  const products = loadSeedCatalogue();
  expect(products.length).toBeGreaterThan(0);
  expect(products.every(product => product.use === 'home' && product._id)).toBe(true);
  expect(products.map(product => product._id)).toEqual(seed.products.filter(product => product.use === 'home').map(product => product.seedKey));
  expect(products.some(product => Object.hasOwn(product, 'photo'))).toBe(false);
});

test('an empty seed file yields an empty catalogue without a database fallback', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-catalogue-'));
  const file = path.join(directory, 'products.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ products: [] }));
    expect(loadSeedCatalogue(file)).toEqual([]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('snapshot loading keeps Mongo IDs and only active home-use products', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-catalogue-snapshot-'));
  const file = path.join(directory, 'catalogue.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ products: [
      { _id: 'mongo-home', use: 'home', name: 'Current product', archived: false },
      { _id: 'mongo-guided', use: 'guided', name: 'Guided product', archived: false },
      { _id: 'mongo-archived', use: 'home', name: 'Archived product', archived: true },
      { seedKey: 'seed-only', use: 'home', name: 'Not a Mongo snapshot row' },
    ] }));
    expect(loadSnapshotCatalogue(file)).toEqual([{
      _id: 'mongo-home', name: 'Current product', category: undefined, use: 'home', pregnancy: 'not_stated',
      archived: false, keyActives: [], strengths: [], suitableFor: [], ingredients: '',
    }]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
