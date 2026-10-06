const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, loadSeed, planInserts, seedCatalogue } = require('./seedCatalogue');

// Smallest buffer that detectImageType accepts as PNG (the 8-byte signature + padding).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

const product = (over = {}) => ({
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
  const list = [{ slug: 'a' }, { slug: 'b' }];
  test('all new', () => expect(planInserts(list, [])).toEqual({ toInsert: list, skipped: [] }));
  test('some existing', () => expect(planInserts(list, ['a'])).toEqual({ toInsert: [list[1]], skipped: [list[0]] }));
  test('all existing', () => expect(planInserts(list, ['a', 'b'])).toEqual({ toInsert: [], skipped: list }));
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
  const fake = existing => ({
    find: jest.fn(() => ({ lean: () => Promise.resolve(existing.map(slug => ({ slug }))) })),
    insertMany: jest.fn(() => Promise.resolve()),
    init: jest.fn(() => Promise.resolve()),
  });

  test('inserts only missing slugs and prints the last line', async () => {
    const dir = fixture([product(), product({ slug: 'b-one', name: 'B One' })]);
    const model = fake(['b-one']);
    const lines = [];
    await seedCatalogue({ dataDir: dir, model, log: l => lines.push(l) });
    expect(model.init).toHaveBeenCalled();
    expect(model.insertMany.mock.calls[0][0].map(p => p.slug)).toEqual(['crystal-silk-peeling']);
    expect(lines[lines.length - 1]).toBe('Inserted 1, skipped 1 (already present).');
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
