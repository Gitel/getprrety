const {
  text,
  sanitizeRoutine,
  sanitizeProductAudit,
  sanitizeProductRecs,
  sanitizeKeyInsights,
  sanitizeSrProducts,
  sanitizeShelfAnalysis,
  LIMITS,
} = require('./analysisFields');

const GARBAGE = [undefined, null, 42, 'string', true, [], () => {}];

describe('text', () => {
  test('trims, caps, accepts finite numbers, rejects everything else', () => {
    expect(text('  hi  ', 10)).toBe('hi');
    expect(text('abcdef', 3)).toBe('abc');
    expect(text(12, 10)).toBe('12');
    expect(text(NaN, 10)).toBe('');
    expect(text({ a: 1 }, 10)).toBe('');
    expect(text(null, 10)).toBe('');
  });
});

describe('sanitizeRoutine', () => {
  test('keeps name/description only, drops empty rows and unknown keys', () => {
    const out = sanitizeRoutine({
      am: [{ name: ' Cleanse ', description: 'Gently', extra: 'x' }, { name: '', description: '  ' }, 'bad'],
      pm: [{ description: 'Only a description' }],
      noon: [{ name: 'ignored' }],
    });
    expect(out).toEqual({
      am: [{ name: 'Cleanse', description: 'Gently' }],
      pm: [{ name: '', description: 'Only a description' }],
    });
  });

  test('caps the number of steps and string lengths', () => {
    const many = Array.from({ length: 40 }, () => ({ name: 'x'.repeat(500), description: 'y'.repeat(5000) }));
    const out = sanitizeRoutine({ am: many });
    expect(out.am).toHaveLength(LIMITS.MAX_STEPS);
    expect(out.am[0].name).toHaveLength(120);
    expect(out.am[0].description).toHaveLength(1000);
  });

  test.each(GARBAGE)('returns an empty routine for %p', value => {
    expect(sanitizeRoutine(value)).toEqual({ am: [], pm: [] });
  });
});

describe('sanitizeProductAudit', () => {
  test('keeps each bucket in the shape the Profile screen reads', () => {
    const out = sanitizeProductAudit({
      keep: [{ product: 'Cleanser', reason: 'Gentle', verdict: 'x' }],
      remove: [{ product: '' }, { product: 'Scrub', reason: 'Too harsh' }],
      replace: [{ from: 'Toner', to: 'Essence', reason: 'Hydration' }, { to: 'no from' }],
      add: [{ product: 'SPF', reason: 'Daily', priority: 'essential' }, { product: 'Serum', priority: 'URGENT!!' }],
    });
    expect(out.keep).toEqual([{ product: 'Cleanser', reason: 'Gentle' }]);
    expect(out.remove).toEqual([{ product: 'Scrub', reason: 'Too harsh' }]);
    expect(out.replace).toEqual([{ from: 'Toner', to: 'Essence', reason: 'Hydration' }]);
    expect(out.add).toEqual([
      { product: 'SPF', reason: 'Daily', priority: 'essential' },
      { product: 'Serum', reason: '', priority: 'recommended' },
    ]);
  });

  test.each(GARBAGE)('returns four empty buckets for %p', value => {
    expect(sanitizeProductAudit(value)).toEqual({ keep: [], remove: [], replace: [], add: [] });
  });
});

describe('sanitizeProductRecs', () => {
  const audit = { add: [{ product: 'SPF' }], replace: [{ from: 'A' }, { from: 'B' }] };

  test('keeps https links, blanks anything else, and bounds indexes by the audit', () => {
    const out = sanitizeProductRecs({
      add: [
        { index: 0, rec: { brand: 'B', name: 'N', price: '$1', retailer: 'R', url: 'https://shop.example/p' } },
        { index: 1, rec: { name: 'past the end of audit.add' } },
      ],
      replace: [
        { index: 1, rec: { name: 'Swap', url: 'javascript:alert(1)' } },
        { index: 0, rec: { brand: '', name: '', price: '', retailer: '', url: '' } }, // blank card
      ],
    }, audit);
    expect(out.add).toEqual([{ index: 0, rec: { brand: 'B', name: 'N', price: '$1', retailer: 'R', url: 'https://shop.example/p' } }]);
    expect(out.replace).toEqual([{ index: 1, rec: { brand: '', name: 'Swap', price: '', retailer: '', url: '' } }]);
  });

  test('with no audit, no pick can survive', () => {
    expect(sanitizeProductRecs({ add: [{ index: 0, rec: { name: 'x' } }] }, undefined)).toEqual({ add: [], replace: [] });
  });
});

describe('sanitizeKeyInsights', () => {
  test('keeps non-empty strings only, capped', () => {
    const out = sanitizeKeyInsights([' One ', '', 7, { a: 1 }, 'x'.repeat(900)]);
    expect(out[0]).toBe('One');
    expect(out[1]).toBe('7');
    expect(out[2]).toHaveLength(500);
    expect(out).toHaveLength(3);
    expect(sanitizeKeyInsights('not a list')).toEqual([]);
  });
});

describe('sanitizeSrProducts', () => {
  test('keeps the rendered fields, renumbers steps, and forces actives to strings', () => {
    const out = sanitizeSrProducts({
      bundle_note: 'Note',
      era_hero_product: { sr_product_name: 'Hero', hero_reason: 'Because', sr_product_id: 'x' },
      am: [
        { step: 9, routine_category: 'Cleanse', sr_product_id: 'sr-1', sr_product_name: 'Foam', key_actives_matched: ['ceramides', 5, {}, ''] },
        { routine_category: '', sr_product_name: '', no_match_note: '' }, // empty: dropped
        { step: 2, routine_category: 'Moisturize', no_match_note: 'Buy any' },
      ],
      pm: 'not a list',
      __proto__: { polluted: true },
    });
    expect(out.bundle_note).toBe('Note');
    expect(out.era_hero_product).toEqual({ sr_product_name: 'Hero', hero_reason: 'Because' });
    expect(out.am.map(s => s.step)).toEqual([1, 2]);
    expect(out.am[0].key_actives_matched).toEqual(['ceramides', '5']);
    expect(out.am[1]).toMatchObject({ routine_category: 'Moisturize', sr_product_id: '', no_match_note: 'Buy any' });
    expect(out.pm).toEqual([]);
    expect(out.polluted).toBeUndefined();
  });

  test('a product name typed without a catalogue id still shows in the app', () => {
    const out = sanitizeSrProducts({ am: [{ routine_category: 'SPF', sr_product_name: 'Sun Guard' }] });
    expect(out.am[0].sr_product_id).toBe('admin-entered');
  });

  test('nothing to show becomes null (the app hides the section)', () => {
    expect(sanitizeSrProducts({ bundle_note: ' ', am: [], pm: [{}] })).toBeNull();
    GARBAGE.forEach(v => expect(sanitizeSrProducts(v)).toBeNull());
  });
});

describe('sanitizeShelfAnalysis', () => {
  test('keeps rendered fields and forces unknown statuses to "unknown"', () => {
    const out = sanitizeShelfAnalysis({
      identified_products: [
        { status: 'Compatible', brand: 'CeraVe', product_name: 'Cleanser', category: 'cleanser', secret: 'x' },
        { status: 'toxic!!', product_name: 'Mystery' },
        { status: 'compatible' }, // nothing identifying: dropped
      ],
      shelf_summary: { overall_note: 'Mostly fine' },
      transition_plan: { first_sr_purchase: 'SPF', steps: ['ignored'] },
    });
    expect(out.identified_products).toHaveLength(2);
    expect(out.identified_products[0]).toMatchObject({ status: 'compatible', brand: 'CeraVe' });
    expect(out.identified_products[0].secret).toBeUndefined();
    expect(out.identified_products[1].status).toBe('unknown');
    expect(out.shelf_summary).toEqual({ overall_note: 'Mostly fine' });
    expect(out.transition_plan).toEqual({ first_sr_purchase: 'SPF' });
  });

  test('no identifiable products becomes null (the app hides the section)', () => {
    expect(sanitizeShelfAnalysis({ identified_products: [], shelf_summary: { overall_note: 'x' } })).toBeNull();
    GARBAGE.forEach(v => expect(sanitizeShelfAnalysis(v)).toBeNull());
  });

  test('caps the product list', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ product_name: `P${i}` }));
    expect(sanitizeShelfAnalysis({ identified_products: many }).identified_products).toHaveLength(LIMITS.MAX_SHELF_PRODUCTS);
  });
});
