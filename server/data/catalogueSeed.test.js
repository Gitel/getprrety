// Guards the committed SR catalogue seed data (server/data/catalogue-seed/).
//
// The data was copied by hand from the client's catalogue PDF (received 2026-10-05) and is
// what `npm run seed:catalogue` inserts. This test re-uses the seed script's own loader, so
// "the test passes" means "the seed script would accept this data", and it pins the few
// values that matter for safety later (which products are clinic-only, which are explicitly
// safe / to avoid in pregnancy) so an accidental edit cannot slip through.
// No database is touched: loadSeed() only reads files.
const { loadSeed } = require('../scripts/seedCatalogue');

const { products, problems } = loadSeed();
const bySlug = Object.fromEntries(products.map(p => [p.slug, p]));

test('the seed data passes every check of the seed script', () => {
  expect(problems).toEqual([]);
});

test('it holds the 34 catalogue products, each with a photo', () => {
  expect(products).toHaveLength(34);
  // loadSeed() only attaches a photo after checking the file exists, is <= 2 MB and is a
  // real JPEG / PNG, so a photo here means a valid one.
  expect(products.filter(p => !p.photo).map(p => p.slug)).toEqual([]);
});

test('per-section counts match the PDF', () => {
  const count = {};
  products.forEach(p => { count[p.category] = (count[p.category] || 0) + 1; });
  expect(count).toEqual({ cleansers_peelings: 7, face_serums: 12, eye: 2, face_creams: 10, masks: 3 });
});

test('only the products the catalogue marks are clinic-only / guided', () => {
  // "Professional only!" in the PDF -> professional; Peel Young -> home use only with the
  // beautician's guidance. Recommendations will later be limited to `home` products.
  const notHome = products.filter(p => p.use !== 'home').map(p => [p.slug, p.use]);
  expect(notHome).toEqual([
    ['caliente-peeling-mask', 'professional'],
    ['light-tomato-peel', 'professional'],
    ['peel-young', 'guided'],
  ]);
});

test('pregnancy is set only where the catalogue says so explicitly', () => {
  const stated = products.filter(p => p.pregnancy !== 'not_stated').map(p => [p.slug, p.pregnancy]);
  expect(stated).toEqual([
    ['caffeine-renewing-mask', 'avoid'],
    ['one-step-peel', 'safe'],
    ['grand-active-serum', 'avoid'],
    ['blue-light-night-cream', 'safe'],
    ['white-bright-cream', 'safe'],
  ]);
});

test('every product has its catalogue text (key actives, ingredients, strengths, suitable for)', () => {
  const empty = products.filter(p =>
    !p.keyActives.length || !p.ingredients || !p.strengths.length || !p.suitableFor.length);
  expect(empty.map(p => p.slug)).toEqual([]);
  // Spot check against the PDF, page 1.
  expect(bySlug['herbal-cleansing-mousse'].name).toBe('Herbal Cleansing Mousse');
  expect(bySlug['herbal-cleansing-mousse'].suitableFor).toContain('Sensitive skin');
});

// The admin form silently truncates over-long values on the first Save (see lines() and
// parseProductForm in server/services/catalogueProducts.js). These caps are copied from
// there (300 chars per list item, 60 items per list, 5000 chars of ingredients); the seed
// must fit, or an admin's first Save would change data they did not touch.
test('the seed data fits the admin form caps', () => {
  const MAX_ITEM_CHARS = 300;
  const MAX_LIST_ITEMS = 60;
  const MAX_INGREDIENTS_CHARS = 5000;
  const tooBig = [];
  for (const p of products) {
    for (const key of ['keyActives', 'strengths', 'suitableFor']) {
      if (p[key].length > MAX_LIST_ITEMS) tooBig.push(`${p.slug}.${key} has too many items`);
      for (const item of p[key]) {
        if (item.length > MAX_ITEM_CHARS) tooBig.push(`${p.slug}.${key} has an item over ${MAX_ITEM_CHARS} chars`);
      }
    }
    if (p.ingredients.length > MAX_INGREDIENTS_CHARS) tooBig.push(`${p.slug}.ingredients is too long`);
  }
  expect(tooBig).toEqual([]);
});
