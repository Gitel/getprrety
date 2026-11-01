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
// The file holds two catalogues, in this order: the 34 SR Cosmetics products, then the 123
// ONmacabim products (catalog HE 30.01.18_FAINAL.pdf, ingredients translated from Hebrew).
const sr = products.slice(0, 34);
const onmacabim = products.slice(34);

test('the seed data passes every check of the seed script', () => {
  expect(problems).toEqual([]);
});

test('it holds the 34 SR products (each with a photo) and the 123 ONmacabim products', () => {
  expect(products).toHaveLength(157);
  // loadSeed() only attaches a photo after checking the file exists, is <= 2 MB and is a
  // real JPEG / PNG, so a photo here means a valid one.
  expect(sr.filter(p => !p.photo).map(p => p.slug)).toEqual([]);
  // The ONmacabim products were added without photos (the admin can upload them later).
  expect(onmacabim.filter(p => p.photo).map(p => p.slug)).toEqual([]);
  // PDF order: first and last product of the ONmacabim catalogue.
  expect(onmacabim[0].slug).toBe('dm-cleansing-gel-oily-and-problematic-skin');
  expect(onmacabim[onmacabim.length - 1].slug).toBe('ps-med-treatment-cream-forte');
});

test('per-section counts match the PDFs', () => {
  const countOf = list => {
    const count = {};
    list.forEach(p => { count[p.category] = (count[p.category] || 0) + 1; });
    return count;
  };
  expect(countOf(sr)).toEqual({ cleansers_peelings: 7, face_serums: 12, eye: 2, face_creams: 10, masks: 3 });
  expect(countOf(onmacabim)).toEqual({
    cleansers_peelings: 21, face_serums: 18, eye: 6, face_creams: 22, masks: 13,
    ampoules_boosters: 28, body: 9, hands_feet: 3, hair_lashes: 3,
  });
});

test('only the products the catalogue marks are clinic-only / guided', () => {
  // "Professional only!" in the PDF -> professional; Peel Young -> home use only with the
  // beautician's guidance. Recommendations will later be limited to `home` products.
  const notHome = sr.filter(p => p.use !== 'home').map(p => [p.slug, p.use]);
  expect(notHome).toEqual([
    ['caliente-peeling-mask', 'professional'],
    ['light-tomato-peel', 'professional'],
    ['peel-young', 'guided'],
  ]);
  // ONmacabim: "professional use only" / institute-only items -> professional; Neutrazen L / G
  // ("continue per specialist instructions") -> guided; the rest -> home.
  const count = { home: 0, guided: 0, professional: 0 };
  onmacabim.forEach(p => { count[p.use] += 1; });
  expect(count).toEqual({ home: 65, guided: 2, professional: 56 });
  expect(onmacabim.filter(p => p.use === 'guided').map(p => p.slug)).toEqual(['neutrazen-l', 'neutrazen-g']);
});

test('pregnancy is set only where the catalogue says so explicitly', () => {
  const stated = products.filter(p => p.pregnancy !== 'not_stated').map(p => [p.slug, p.pregnancy]);
  expect(stated).toEqual([
    ['caffeine-renewing-mask', 'avoid'],
    ['one-step-peel', 'safe'],
    ['grand-active-serum', 'avoid'],
    ['blue-light-night-cream', 'safe'],
    ['white-bright-cream', 'safe'],
    // ONmacabim: only the lash / brow serum is stated safe in pregnancy / breastfeeding.
    ['ps-med-risim-gabot-serum', 'safe'],
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

// seedKey is the permanent id the seed script matches on (see seedCatalogue.js): every product
// needs one, they must be unique, and they must look like a slug.
test('every product has a unique, slug-shaped seedKey', () => {
  const keys = products.map(p => p.seedKey);
  expect(keys.every(k => typeof k === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(k))).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);
});
