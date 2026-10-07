const CatalogueProduct = require('./CatalogueProduct');

const valid = {
  slug: 'herbal-cleansing-mousse',
  name: '  Herbal Cleansing Mousse ',
  category: 'cleansers_peelings',
  use: 'home',
  pregnancy: 'not_stated',
};

// validate() (not validateSync) is used here because only it runs the pre('validate') hook
// that derives nameKey.
test('a valid product passes, trims the name and derives nameKey', async () => {
  const doc = new CatalogueProduct(valid);
  await expect(doc.validate()).resolves.toBeUndefined();
  expect(doc.name).toBe('Herbal Cleansing Mousse');
  expect(doc.nameKey).toBe('herbal cleansing mousse');
});

test('defaults: empty lists, empty ingredients, not archived, no photo', () => {
  const doc = new CatalogueProduct(valid);
  expect(doc.keyActives).toEqual([]);
  expect(doc.strengths).toEqual([]);
  expect(doc.suitableFor).toEqual([]);
  expect(doc.ingredients).toBe('');
  expect(doc.archived).toBe(false);
  expect(doc.photo.data).toBeUndefined();
});

test('slug and name are required', () => {
  const errors = new CatalogueProduct({}).validateSync().errors;
  expect(errors.slug).toBeDefined();
  expect(errors.name).toBeDefined();
});

test.each(['Bad Slug', 'trailing-', '-leading', 'double--dash', 'UPPER'])('rejects slug %p', slug => {
  expect(new CatalogueProduct({ ...valid, slug }).validateSync().errors.slug).toBeDefined();
});

test('name longer than 120 characters is rejected', () => {
  expect(new CatalogueProduct({ ...valid, name: 'a'.repeat(121) }).validateSync().errors.name).toBeDefined();
});

test.each([['category', 'soap'], ['use', 'spa'], ['pregnancy', 'maybe']])('rejects an unknown %s', (field, value) => {
  expect(new CatalogueProduct({ ...valid, [field]: value }).validateSync().errors[field]).toBeDefined();
});

test('exports the enum lists the contract names', () => {
  expect(CatalogueProduct.CATEGORIES).toEqual(['cleansers_peelings', 'face_serums', 'eye', 'face_creams', 'masks']);
  expect(CatalogueProduct.USES).toEqual(['home', 'guided', 'professional']);
  expect(CatalogueProduct.PREGNANCY).toEqual(['safe', 'avoid', 'not_stated']);
});

test('seedKey is optional (admin-created products have none)', async () => {
  // validate() (not validateSync) so the pre('validate') hook fills nameKey first.
  await expect(new CatalogueProduct(valid).validate()).resolves.toBeUndefined();
  expect(new CatalogueProduct({ ...valid, seedKey: 'herbal-cleansing-mousse' }).seedKey).toBe('herbal-cleansing-mousse');
});
