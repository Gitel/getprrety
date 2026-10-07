const {
  slugify, parseProductForm, createProduct, updateProduct, setArchived, replacePhoto,
  listProducts, getProduct, getProductPhoto, MAX_PHOTO_BYTES,
  CATEGORY_LABELS, USE_LABELS, PREGNANCY_LABELS,
} = require('./catalogueProducts');
const CatalogueProduct = require('../models/CatalogueProduct');

// The form dropdowns are built from the *_LABELS keys while validation uses the model enums.
// If the two lists drift apart the form would offer a value the server rejects (or hide a valid one).
test('the label maps list exactly the values the model allows', () => {
  expect(Object.keys(CATEGORY_LABELS)).toEqual(CatalogueProduct.CATEGORIES);
  expect(Object.keys(USE_LABELS)).toEqual(CatalogueProduct.USES);
  expect(Object.keys(PREGNANCY_LABELS)).toEqual(CatalogueProduct.PREGNANCY);
});

const ID = '64b0000000000000000000aa';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const form = { name: ' Herbal Mousse ', category: 'cleansers_peelings', use: 'home', pregnancy: 'safe' };

// Fake model: findById(...).select(...).lean() resolves `current`.
function fakeModel(current, extra = {}) {
  return {
    findById: jest.fn(() => ({ select: jest.fn(() => ({ lean: async () => current })) })),
    findByIdAndUpdate: jest.fn(async () => ({})),
    create: jest.fn(async doc => ({ _id: ID, ...doc })),
    ...extra,
  };
}

describe('slugify', () => {
  test.each([
    ['Crystal & Silk Peeling', 'crystal-silk-peeling'],
    ['D. Immediate Ageless Serum', 'd-immediate-ageless-serum'],
    ['Active Face Serum & H.A', 'active-face-serum-h-a'],
    ['  --Hello__World--  ', 'hello-world'],
    ['!!!', ''],
    [null, ''],
  ])('%p -> %p', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe('parseProductForm', () => {
  test('normalizes a valid form; textareas split on newlines, empty lines dropped', () => {
    const { product } = parseProductForm({
      ...form,
      keyActives: ' A \r\n\r\nB\n  \nC',
      strengths: ['x', ' ', 'y'],
      ingredients: '  water  ',
      _csrf: 'tok',
      extra: 1,
    });
    expect(product).toEqual({
      name: 'Herbal Mousse', category: 'cleansers_peelings', use: 'home', pregnancy: 'safe',
      keyActives: ['A', 'B', 'C'], strengths: ['x', 'y'], suitableFor: [], ingredients: 'water',
    });
  });

  test('caps list length (60), item length (300) and name (120)', () => {
    const { product } = parseProductForm({
      ...form,
      name: 'n'.repeat(200),
      keyActives: Array.from({ length: 80 }, (_, i) => `item ${i}`).join('\n'),
      strengths: 'z'.repeat(400),
    });
    expect(product.name).toHaveLength(120);
    expect(product.keyActives).toHaveLength(60);
    expect(product.strengths[0]).toHaveLength(300);
  });

  test.each([
    [{ ...form, name: '   ' }],
    [{ ...form, category: 'soap' }],
    [{ ...form, use: '' }],
    [{ ...form, pregnancy: undefined }],
    [null],
  ])('rejects %p', body => {
    expect(parseProductForm(body)).toEqual({ error: 'catalogue_invalid' });
  });
});

describe('createProduct', () => {
  test('sets slug and nameKey and returns the id', async () => {
    const model = fakeModel(null);
    const result = await createProduct(form, { productModel: model });
    expect(result).toEqual({ ok: true, id: ID, slug: 'herbal-mousse' });
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Herbal Mousse', slug: 'herbal-mousse', nameKey: 'herbal mousse',
    }));
  });

  test('invalid form or a name with no a-z0-9 is catalogue_invalid and writes nothing', async () => {
    const model = fakeModel(null);
    expect(await createProduct({ ...form, name: '' }, { productModel: model })).toEqual({ ok: false, code: 'catalogue_invalid' });
    expect(await createProduct({ ...form, name: '!!!' }, { productModel: model })).toEqual({ ok: false, code: 'catalogue_invalid' });
    expect(model.create).not.toHaveBeenCalled();
  });

  test.each([
    [{ code: 11000, keyPattern: { nameKey: 1 } }],
    [{ code: 11000, keyPattern: { slug: 1 } }],
    [{ code: 11000, message: 'E11000 duplicate key error collection: x index: nameKey_1 dup key' }],
  ])('duplicate key %p is catalogue_name_taken', async err => {
    const model = fakeModel(null, { create: jest.fn().mockRejectedValue(err) });
    expect(await createProduct(form, { productModel: model })).toEqual({ ok: false, code: 'catalogue_name_taken' });
  });

  test('other errors (incl. a duplicate on another index) are rethrown', async () => {
    const other = { code: 11000, keyPattern: { somethingElse: 1 } };
    await expect(createProduct(form, { productModel: fakeModel(null, { create: jest.fn().mockRejectedValue(other) }) })).rejects.toBe(other);
    const boom = new Error('down');
    await expect(createProduct(form, { productModel: fakeModel(null, { create: jest.fn().mockRejectedValue(boom) }) })).rejects.toBe(boom);
  });
});

describe('updateProduct', () => {
  const current = {
    name: 'Herbal Mousse', category: 'cleansers_peelings', use: 'home', pregnancy: 'safe',
    keyActives: ['A', 'B'], strengths: [], suitableFor: [], ingredients: '',
  };

  test('unchanged form writes nothing', async () => {
    const model = fakeModel(current);
    const result = await updateProduct(ID, { ...form, keyActives: 'A\nB' }, { productModel: model });
    expect(result).toEqual({ ok: true, changed: [] });
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('writes only changed fields with one $set; arrays compared element-wise', async () => {
    const model = fakeModel(current);
    const result = await updateProduct(ID, { ...form, use: 'professional', keyActives: 'A\nC' }, { productModel: model });
    expect(result).toEqual({ ok: true, changed: ['use', 'keyActives'] });
    expect(model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(ID, { $set: { use: 'professional', keyActives: ['A', 'C'] } }, { runValidators: true });
  });

  test('a rename also sets nameKey, reports only name, and never touches slug', async () => {
    const model = fakeModel(current);
    const result = await updateProduct(ID, { ...form, name: 'Herbal Foam', keyActives: 'A\nB' }, { productModel: model });
    expect(result).toEqual({ ok: true, changed: ['name'] });
    const { $set } = model.findByIdAndUpdate.mock.calls[0][1];
    expect($set).toEqual({ name: 'Herbal Foam', nameKey: 'herbal foam' });
    expect($set.slug).toBeUndefined();
  });

  test('not_found for a malformed id (no query) and a missing product', async () => {
    const model = fakeModel(null);
    expect(await updateProduct('nope', form, { productModel: model })).toEqual({ ok: false, code: 'not_found' });
    expect(model.findById).not.toHaveBeenCalled();
    expect(await updateProduct(ID, form, { productModel: model })).toEqual({ ok: false, code: 'not_found' });
  });

  test('invalid form is catalogue_invalid before any query', async () => {
    const model = fakeModel(current);
    expect(await updateProduct(ID, { ...form, name: '' }, { productModel: model })).toEqual({ ok: false, code: 'catalogue_invalid' });
    expect(model.findById).not.toHaveBeenCalled();
  });

  test('renaming onto an existing name is catalogue_name_taken', async () => {
    const model = fakeModel(current, { findByIdAndUpdate: jest.fn().mockRejectedValue({ code: 11000, keyPattern: { nameKey: 1 } }) });
    expect(await updateProduct(ID, { ...form, name: 'Other' }, { productModel: model })).toEqual({ ok: false, code: 'catalogue_name_taken' });
  });
});

describe('setArchived', () => {
  test('archives, and is a no-op when already in that state', async () => {
    const model = fakeModel({ archived: false });
    expect(await setArchived(ID, true, { productModel: model })).toEqual({ ok: true, changed: true });
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(ID, { $set: { archived: true } });

    const same = fakeModel({ archived: false });
    expect(await setArchived(ID, false, { productModel: same })).toEqual({ ok: true, changed: false });
    expect(same.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('not_found', async () => {
    expect(await setArchived('bad', true, { productModel: fakeModel(null) })).toEqual({ ok: false, code: 'not_found' });
    expect(await setArchived(ID, true, { productModel: fakeModel(null) })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('replacePhoto', () => {
  test('stores a JPEG with its detected type', async () => {
    const model = fakeModel({ _id: ID });
    expect(await replacePhoto(ID, { buffer: JPEG, size: JPEG.length }, { productModel: model })).toEqual({ ok: true });
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(ID, { $set: { photo: { data: JPEG, mimeType: 'image/jpeg', size: JPEG.length } } });
  });

  test.each([
    ['no file', undefined],
    ['not an image', { buffer: Buffer.from('GIF89a......'), size: 12 }],
    ['over 2 MB', { buffer: JPEG, size: MAX_PHOTO_BYTES + 1 }],
  ])('%s is catalogue_photo_invalid and writes nothing', async (_n, file) => {
    const model = fakeModel({ _id: ID });
    expect(await replacePhoto(ID, file, { productModel: model })).toEqual({ ok: false, code: 'catalogue_photo_invalid' });
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('not_found', async () => {
    expect(await replacePhoto(ID, { buffer: JPEG, size: 5 }, { productModel: fakeModel(null) })).toEqual({ ok: false, code: 'not_found' });
    expect(await replacePhoto('bad', { buffer: JPEG, size: 5 }, { productModel: fakeModel(null) })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('reads', () => {
  test('listProducts excludes photo bytes, adds hasPhoto, sorts by category order then name', async () => {
    const docs = [
      { name: 'Zed', category: 'masks' },
      { name: 'Beta', category: 'eye', photo: { size: 10, mimeType: 'image/png' } },
      { name: 'Alpha', category: 'eye' },
      { name: 'Clean', category: 'cleansers_peelings' },
    ];
    const select = jest.fn(() => ({ lean: async () => docs }));
    const model = { find: jest.fn(() => ({ select })) };
    const list = await listProducts({ productModel: model });
    expect(select).toHaveBeenCalledWith('-photo.data');
    expect(list.map(p => p.name)).toEqual(['Clean', 'Alpha', 'Beta', 'Zed']);
    expect(list.map(p => p.hasPhoto)).toEqual([false, false, true, false]);
  });

  test('getProduct returns the doc with hasPhoto, null for bad id (no query) or missing', async () => {
    const model = fakeModel({ name: 'A', photo: { size: 3 } });
    expect(await getProduct(ID, { productModel: model })).toEqual({ name: 'A', photo: { size: 3 }, hasPhoto: true });
    expect(await getProduct('bad', { productModel: model })).toBeNull();
    expect(model.findById).toHaveBeenCalledTimes(1);
    expect(await getProduct(ID, { productModel: fakeModel(null) })).toBeNull();
  });

  test('getProductPhoto returns bytes and type, or null', async () => {
    expect(await getProductPhoto(ID, { productModel: fakeModel({ photo: { data: JPEG, mimeType: 'image/jpeg' } }) }))
      .toEqual({ data: JPEG, mimeType: 'image/jpeg' });
    expect(await getProductPhoto(ID, { productModel: fakeModel({}) })).toBeNull();
    expect(await getProductPhoto(ID, { productModel: fakeModel(null) })).toBeNull();
    expect(await getProductPhoto('bad', { productModel: fakeModel(null) })).toBeNull();
  });

  test('getProductPhoto unwraps the BSON Binary that .lean() really returns into a Buffer', async () => {
    // A real lean read gives mongodb's Binary, not a Buffer (found by the admin e2e suite:
    // the thumbnails stayed blank because Binary was sent as JSON).
    const binary = new (require('mongoose').mongo.Binary)(JPEG);
    const out = await getProductPhoto(ID, { productModel: fakeModel({ photo: { data: binary, mimeType: 'image/jpeg' } }) });
    expect(Buffer.isBuffer(out.data)).toBe(true);
    expect(out.data.equals(JPEG)).toBe(true);
  });
});
