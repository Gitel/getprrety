const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, loadSeed, planInserts, seedCatalogue } = require('./seedCatalogue');

// Smallest buffer that detectImageType accepts as PNG (the 8-byte signature + padding).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

// seedKey defaults to the slug (like in the real products.json); pass seedKey to override.
const product = (over = {}) => ({
  seedKey: over.slug || 'crystal-silk-peeling',
  slug: 'crystal-silk-peeling', name: 'Crystal Silk Peeling', category: 'cleansers_peelings',
  use: 'home', pregnancy: 'safe', keyActives: ['a'], strengths: [], suitableFor: ['dry'],
  ingredients: 'water', photo: null, ...over,
});

// Builds a temp seed folder with the given products and photo files; returns its path.
function fixture(products, photos = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  fs.mkdirSync(path.join(dir, 'photos'));
  fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify({ source: 't', products }));
  for (const [name, buf] of Object.entries(photos)) fs.writeFileSync(path.join(dir, 'photos', name), buf);
  return dir;
}

describe('parseArgs', () => {
  test('defaults', () => expect(parseArgs([])).toEqual({ dryRun: false }));
  test('--dry-run', () => expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true }));
  test('unknown argument throws', () => expect(() => parseArgs(['--force'])).toThrow('Unknown argument: --force'));
});

describe('planInserts', () => {
  const list = [
    { seedKey: 'a', slug: 'a', name: 'A' },
    { seedKey: 'b', slug: 'b', name: 'B' },
  ];
  const doc = (seedKey, slug, name) => ({ seedKey, slug, nameKey: name.toLowerCase() });

  test('all new', () => expect(planInserts(list, [])).toEqual({ toInsert: list, skipped: [], warnings: [] }));
  test('some already seeded', () => {
    expect(planInserts(list, [doc('a', 'a', 'A')])).toEqual({ toInsert: [list[1]], skipped: [list[0]], warnings: [] });
  });
  test('all already seeded', () => {
    expect(planInserts(list, [doc('a', 'a', 'A'), doc('b', 'b', 'B')])).toEqual({ toInsert: [], skipped: list, warnings: [] });
  });
  test('a renamed product is still "already seeded" (matched by seedKey, no warning)', () => {
    const result = planInserts(list, [doc('a', 'a-new-name', 'A New Name'), doc('b', 'b', 'B')]);
    expect(result.toInsert).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
  test('slug or name used by a product with another/no seedKey -> skipped with a warning', () => {
    // An admin-created product (no seedKey) already has the slug "a"; another one has the name "b".
    const result = planInserts(list, [doc(undefined, 'a', 'Other A'), doc(undefined, 'zzz', 'b')]);
    expect(result.toInsert).toEqual([]);
    expect(result.skipped).toEqual(list);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/WARNING: skipped "a"/);
  });
});

describe('loadSeed', () => {
  test('valid product with a PNG photo', () => {
    const { products, problems } = loadSeed(fixture([product({ photo: 'p.png' })], { 'p.png': PNG }));
    expect(problems).toEqual([]);
    expect(products[0].photo).toEqual({ data: PNG, mimeType: 'image/png', size: PNG.length });
  });
  test('valid product without photo', () => {
    const { products, problems } = loadSeed(fixture([product()]));
    expect(problems).toEqual([]);
    expect(products[0].photo).toBeUndefined();
  });
  test.each([
    ['bad slug', product({ slug: 'wrong' }), /slug must be/],
    ['bad enum', product({ category: 'nope' }), /invalid category/],
    ['missing photo file', product({ photo: 'gone.png' }), /not found/],
    ['non-image photo', product({ photo: 't.png' }), /not a JPEG or PNG/],
    ['non-array list', product({ keyActives: 'x' }), /keyActives/],
  ])('%s', (_label, p, re) => {
    const { problems } = loadSeed(fixture([p], { 't.png': Buffer.from('hello world') }));
    expect(problems.join('\n')).toMatch(re);
  });
  test('seedKey is required, unique and slug-shaped (a bad file fails loudly)', () => {
    const missing = product();
    delete missing.seedKey;
    expect(loadSeed(fixture([missing])).problems.join('\n')).toMatch(/seedKey is required/);
    expect(loadSeed(fixture([product({ seedKey: 'Bad Key' })])).problems.join('\n')).toMatch(/seedKey is required/);
    const dup = loadSeed(fixture([product(), product({ slug: 'b-one', name: 'B One', seedKey: 'crystal-silk-peeling' })]));
    expect(dup.problems.join('\n')).toMatch(/duplicate seedKey/);
  });
  test('the seedKey comes from the file, not from the slug', () => {
    const { products, problems } = loadSeed(fixture([product({ slug: 'crystal-silk', name: 'Crystal Silk', seedKey: 'crystal-silk-peeling' })]));
    expect(problems).toEqual([]);
    expect(products[0]).toMatchObject({ slug: 'crystal-silk', seedKey: 'crystal-silk-peeling' });
  });
  test('duplicate slug', () => {
    const { problems } = loadSeed(fixture([product(), product()]));
    expect(problems.join('\n')).toMatch(/duplicate slug/);
  });
  test('duplicate name with different case', () => {
    const { problems } = loadSeed(fixture([product(), product({ slug: 'crystal-silk-peeling-2', name: 'CRYSTAL SILK PEELING' })]));
    expect(problems.join('\n')).toMatch(/duplicate name/);
  });
  test('missing products.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    expect(loadSeed(dir).problems[0]).toMatch(/Cannot read/);
  });
});

describe('seedCatalogue with a fake model', () => {
  // `existing` = documents already in the collection ({ seedKey, slug, nameKey }).
  const fake = existing => ({
    find: jest.fn(() => ({ lean: () => Promise.resolve(existing) })),
    insertMany: jest.fn(() => Promise.resolve()),
    init: jest.fn(() => Promise.resolve()),
  });

  test('inserts only missing slugs and prints the last line', async () => {
    const dir = fixture([product(), product({ slug: 'b-one', name: 'B One' })]);
    const model = fake([{ seedKey: 'b-one', slug: 'b-one', nameKey: 'b one' }]);
    const lines = [];
    await seedCatalogue({ dataDir: dir, model, log: l => lines.push(l) });
    expect(model.init).toHaveBeenCalled();
    expect(model.insertMany.mock.calls[0][0].map(p => p.slug)).toEqual(['crystal-silk-peeling']);
    expect(lines[lines.length - 1]).toBe('Inserted 1, skipped 1 (already present).');
  });

  test('a seeded product that was renamed is not inserted again and nothing else is written', async () => {
    const dir = fixture([product()]);
    // Same seedKey, but the admin renamed it: slug and name are different now.
    const model = fake([{ seedKey: 'crystal-silk-peeling', slug: 'silk-peel-pro', nameKey: 'silk peel pro' }]);
    const lines = [];
    const result = await seedCatalogue({ dataDir: dir, model, log: l => lines.push(l) });
    expect(result.inserted).toBe(0);
    expect(model.insertMany).not.toHaveBeenCalled();
    expect(lines[lines.length - 1]).toBe('Inserted 0, skipped 1 (already present).');
  });

  test('a product renamed IN THE FILE (new name and slug, same seedKey) is not inserted again', async () => {
    const dir = fixture([product({ slug: 'crystal-silk', name: 'Crystal Silk', seedKey: 'crystal-silk-peeling' })]);
    // The DB already holds the product under its first seedKey (and its old name / slug).
    const model = fake([{ seedKey: 'crystal-silk-peeling', slug: 'crystal-silk-peeling', nameKey: 'crystal silk peeling' }]);
    const lines = [];
    const result = await seedCatalogue({ dataDir: dir, model, log: l => lines.push(l) });
    expect(result.inserted).toBe(0);
    expect(model.insertMany).not.toHaveBeenCalled();
    expect(lines.some(l => l.includes('WARNING'))).toBe(false);
  });

  test('a slug / name collision with another product is skipped with a warning, no crash, no update', async () => {
    const dir = fixture([product(), product({ slug: 'b-one', name: 'B One' })]);
    // An admin-created product (no seedKey) already owns the slug of the first seed product.
    const model = fake([{ slug: 'crystal-silk-peeling', nameKey: 'crystal silk peeling' }]);
    model.updateOne = jest.fn();
    model.deleteMany = jest.fn();
    const lines = [];
    const result = await seedCatalogue({ dataDir: dir, model, log: l => lines.push(l) });
    expect(model.insertMany.mock.calls[0][0].map(p => p.slug)).toEqual(['b-one']);
    expect(result).toMatchObject({ inserted: 1, skipped: 1 });
    expect(lines.some(l => /WARNING: skipped "crystal-silk-peeling"/.test(l))).toBe(true);
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(model.deleteMany).not.toHaveBeenCalled();
    // Every inserted document carries its permanent seedKey.
    expect(model.insertMany.mock.calls[0][0][0].seedKey).toBe('b-one');
  });

  test('--dry-run writes nothing', async () => {
    const model = fake([]);
    const lines = [];
    await seedCatalogue({ dryRun: true, dataDir: fixture([product()]), model, log: l => lines.push(l) });
    expect(model.insertMany).not.toHaveBeenCalled();
    expect(lines[lines.length - 1]).toBe('Would insert 1, skip 0 (already present).');
  });

  test('invalid data throws before touching the model', async () => {
    const model = fake([]);
    await expect(seedCatalogue({ dataDir: fixture([product({ slug: 'x' })]), model, log: () => {} })).rejects.toThrow('nothing was written');
    expect(model.find).not.toHaveBeenCalled();
  });
});
