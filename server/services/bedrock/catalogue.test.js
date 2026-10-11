const { loadCatalogue } = require('./catalogue');
const seed = require('../../data/catalogue-seed/products.json');

test('loads only home-use products with permanent repository IDs and no photo paths', () => {
  const products = loadCatalogue();
  expect(products.length).toBeGreaterThan(0);
  expect(products.every(product => product.use === 'home' && product._id)).toBe(true);
  expect(products.map(product => product._id)).toEqual(seed.products.filter(product => product.use === 'home').map(product => product.seedKey));
  expect(products.some(product => Object.hasOwn(product, 'photo'))).toBe(false);
});

test('an empty authoritative product file yields an empty catalogue without a database fallback', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bedrock-catalogue-'));
  const file = path.join(directory, 'products.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ products: [] }));
    expect(loadCatalogue(file)).toEqual([]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
