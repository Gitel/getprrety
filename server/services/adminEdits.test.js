const { parseProfileForm, updateUserProfile } = require('./adminEdits');

const ID = '64b0000000000000000000aa';

function fakeUserModel(current, updateImpl) {
  return {
    findById: jest.fn(() => ({ select: () => ({ lean: async () => current }) })),
    findByIdAndUpdate: jest.fn(updateImpl || (async () => ({}))),
  };
}

describe('parseProfileForm', () => {
  test('normalizes a valid form and turns empty optionals into null', () => {
    expect(parseProfileForm({ firstName: ' Ada ', email: ' Ada@Example.COM ', skincareTiming: '', city: '', country: 'il' }))
      .toEqual({ updates: { firstName: 'Ada', email: 'ada@example.com', skincareTiming: null, city: null, country: 'IL' } });
  });

  test.each([
    [{ email: 'nope' }, 'profile_invalid_email'],
    [{}, 'profile_invalid_email'],
    [{ email: 'a@b.co', skincareTiming: 'noon' }, 'profile_invalid_timing'],
    [{ email: 'a@b.co', country: 'Israel' }, 'profile_invalid_country'],
    [{ email: 'a@b.co', country: '1L' }, 'profile_invalid_country'],
  ])('rejects %p with %s', (body, code) => {
    expect(parseProfileForm(body)).toEqual({ error: code });
  });
});

describe('updateUserProfile', () => {
  const current = { firstName: 'Ada', email: 'ada@example.com', skincareTiming: 'both', city: null, country: null };

  test('writes only the changed fields with one $set and reports them', async () => {
    const model = fakeUserModel(current);
    const result = await updateUserProfile(ID, { firstName: 'Ada', email: 'ada@example.com', skincareTiming: 'night', city: 'Haifa', country: '' }, { userModel: model });
    expect(result).toEqual({ ok: true, changed: ['skincareTiming', 'city'] });
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(ID, { $set: { skincareTiming: 'night', city: 'Haifa' } }, { runValidators: true });
  });

  test('an unchanged form writes nothing', async () => {
    const model = fakeUserModel(current);
    const result = await updateUserProfile(ID, { ...current, skincareTiming: 'both' }, { userModel: model });
    expect(result).toEqual({ ok: true, changed: [] });
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('an email already used by another account is a friendly error', async () => {
    const dup = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } });
    const model = fakeUserModel(current, async () => { throw dup; });
    await expect(updateUserProfile(ID, { ...current, email: 'taken@example.com' }, { userModel: model }))
      .resolves.toEqual({ ok: false, code: 'profile_email_taken' });
  });

  test('any other database error is rethrown', async () => {
    const model = fakeUserModel(current, async () => { throw new Error('mongo down'); });
    await expect(updateUserProfile(ID, { ...current, email: 'new@example.com' }, { userModel: model })).rejects.toThrow('mongo down');
  });

  test('unknown or malformed user ids are notfound; invalid forms never read the DB', async () => {
    await expect(updateUserProfile(ID, current, { userModel: fakeUserModel(null) })).resolves.toEqual({ ok: false, code: 'user_notfound' });
    await expect(updateUserProfile('x', current, { userModel: fakeUserModel(current) })).resolves.toEqual({ ok: false, code: 'user_notfound' });
    const model = fakeUserModel(current);
    await expect(updateUserProfile(ID, { email: 'bad' }, { userModel: model })).resolves.toEqual({ ok: false, code: 'profile_invalid_email' });
    expect(model.findById).not.toHaveBeenCalled();
  });
});

describe('updateAnalysisSection', () => {
  const AID = '64b000000000000000000001';
  const { updateAnalysisSection } = require('./adminEdits');

  function fakeAnalysisModel(current) {
    return {
      findById: jest.fn(() => ({ select: () => ({ lean: async () => current }) })),
      findByIdAndUpdate: jest.fn(async () => ({})),
    };
  }

  const stored = {
    userId: 'u1',
    eraId: 'barrier_healing',
    skinAnalysis: 'Old text',
    keyInsights: ['One'],
    affirmation: 'I glow',
  };

  test('fields: changing the era writes eraId AND the complete era object', async () => {
    const model = fakeAnalysisModel(stored);
    const result = await updateAnalysisSection(AID, 'fields', {
      eraId: 'glow_building', skinAnalysis: 'Old text', keyInsights: ['One', ' '], affirmation: 'I glow',
    }, { analysisModel: model });
    expect(result).toEqual({ ok: true, changed: ['eraId', 'era'], action: 'analysis_fields_updated', userId: 'u1' });
    const { $set } = model.findByIdAndUpdate.mock.calls[0][1];
    expect($set.era).toMatchObject({ id: 'glow_building', name: 'Glow Building Era', color: '#B8924A', bg: '#FBF6EE', emoji: expect.any(String) });
  });

  test('fields: same era, new text writes only the text fields that changed', async () => {
    const model = fakeAnalysisModel(stored);
    const result = await updateAnalysisSection(AID, 'fields', {
      eraId: 'barrier_healing', skinAnalysis: ' New text ', keyInsights: ['One', 'Two'], affirmation: 'I glow',
    }, { analysisModel: model });
    expect(result.changed).toEqual(['skinAnalysis', 'keyInsights']);
    expect(model.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $set: { skinAnalysis: 'New text', keyInsights: ['One', 'Two'] } });
  });

  test('fields: an unchanged form writes nothing', async () => {
    const model = fakeAnalysisModel(stored);
    const result = await updateAnalysisSection(AID, 'fields', { ...stored }, { analysisModel: model });
    expect(result.changed).toEqual([]);
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('fields: an era outside the fixed list is rejected (the app would crash on it)', async () => {
    const model = fakeAnalysisModel(stored);
    await expect(updateAnalysisSection(AID, 'fields', { eraId: 'made_up' }, { analysisModel: model }))
      .resolves.toEqual({ ok: false, code: 'analysis_invalid_era' });
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('unknown or malformed analysis ids are notfound', async () => {
    await expect(updateAnalysisSection(AID, 'fields', {}, { analysisModel: fakeAnalysisModel(null) }))
      .resolves.toEqual({ ok: false, code: 'analysis_notfound' });
    await expect(updateAnalysisSection('x', 'fields', {}, { analysisModel: fakeAnalysisModel(stored) }))
      .resolves.toEqual({ ok: false, code: 'analysis_notfound' });
  });

  test('an unknown section name is a programming error', async () => {
    await expect(updateAnalysisSection(AID, 'nope', {}, { analysisModel: fakeAnalysisModel(stored) })).rejects.toThrow('Unknown analysis section');
  });
});

describe('updateAnalysisSection: routine', () => {
  const AID = '64b000000000000000000001';
  const { updateAnalysisSection } = require('./adminEdits');
  const model = current => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => current }) })),
    findByIdAndUpdate: jest.fn(async () => ({})),
  });

  test('writes the sanitized routine as one whole-field $set', async () => {
    const m = model({ userId: 'u1', routine: { am: [{ name: 'Old', description: '' }], pm: [] } });
    const result = await updateAnalysisSection(AID, 'routine', {
      routine: { am: [{ name: ' Cleanse ', description: 'Gently' }, { name: '', description: '' }], pm: [{ name: 'Retinol' }] },
    }, { analysisModel: m });
    expect(result).toMatchObject({ ok: true, changed: ['routine'], action: 'routine_updated' });
    expect(m.findByIdAndUpdate.mock.calls[0][1]).toEqual({
      $set: { routine: { am: [{ name: 'Cleanse', description: 'Gently' }], pm: [{ name: 'Retinol', description: '' }] } },
    });
  });

  test('saving the same routine is not a change', async () => {
    const routine = { am: [{ name: 'Cleanse', description: 'Gently' }], pm: [] };
    const m = model({ userId: 'u1', routine });
    const result = await updateAnalysisSection(AID, 'routine', { routine }, { analysisModel: m });
    expect(result.changed).toEqual([]);
    expect(m.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('updateAnalysisSection: audit', () => {
  const { updateAnalysisSection } = require('./adminEdits');
  test('writes the four sanitized buckets as one whole-field $set', async () => {
    const m = {
      findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ userId: 'u1', productAudit: {} }) }) })),
      findByIdAndUpdate: jest.fn(async () => ({})),
    };
    const result = await updateAnalysisSection('64b000000000000000000001', 'audit', {
      productAudit: { keep: [{ product: 'Cleanser', reason: 'Fine' }], add: [{ product: 'SPF', priority: 'essential' }], junk: [1] },
    }, { analysisModel: m });
    expect(result).toMatchObject({ ok: true, changed: ['productAudit'], action: 'product_audit_updated' });
    expect(m.findByIdAndUpdate.mock.calls[0][1].$set.productAudit).toEqual({
      keep: [{ product: 'Cleanser', reason: 'Fine' }],
      remove: [],
      replace: [],
      add: [{ product: 'SPF', reason: '', priority: 'essential' }],
    });
  });
});

describe('updateAnalysisSection: audit + product picks, SR Ritual, shelf', () => {
  const { updateAnalysisSection } = require('./adminEdits');
  const AID = '64b000000000000000000001';
  const model = current => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ userId: 'u1', ...current }) }) })),
    findByIdAndUpdate: jest.fn(async () => ({})),
  });

  test('picks are paired with their item AFTER empty rows are dropped', async () => {
    const m = model({ productAudit: {}, productRecs: null });
    const result = await updateAnalysisSection(AID, 'audit', {
      productAudit: {
        add: [
          { product: '', pick: { name: 'belongs to a blank row' } }, // dropped row, pick dropped too
          { product: 'SPF', priority: 'essential', pick: { brand: 'La Roche', name: 'Anthelios', url: 'https://x.example/a' } },
        ],
        replace: [{ from: 'Toner', to: 'Essence', pick: { brand: '', name: '', price: '', retailer: '', url: '' } }],
      },
    }, { analysisModel: m });

    expect(result.changed).toEqual(['productAudit', 'productRecs']);
    expect(result.action).toBe('product_audit_updated');
    const { $set } = m.findByIdAndUpdate.mock.calls[0][1];
    expect($set.productAudit.add).toEqual([{ product: 'SPF', reason: '', priority: 'essential' }]);
    expect($set.productRecs).toEqual({
      add: [{ index: 0, rec: { brand: 'La Roche', name: 'Anthelios', price: '', retailer: '', url: 'https://x.example/a' } }],
      replace: [], // an all-blank pick is no pick
    });
    expect($set.productRecsEditedAt).toBeInstanceOf(Date);
  });

  test('changing only a pick is audited as a picks update', async () => {
    const productAudit = { keep: [], remove: [], replace: [], add: [{ product: 'SPF', reason: '', priority: 'essential' }] };
    const m = model({ productAudit, productRecs: null });
    const result = await updateAnalysisSection(AID, 'audit', {
      productAudit: { add: [{ product: 'SPF', priority: 'essential', pick: { name: 'Anthelios' } }] },
    }, { analysisModel: m });
    expect(result.changed).toEqual(['productRecs']);
    expect(result.action).toBe('product_picks_updated');
  });

  test('clearing every pick hands picks back to the AI (productRecs null, stamp cleared)', async () => {
    const productAudit = { keep: [], remove: [], replace: [], add: [{ product: 'SPF', reason: '', priority: 'essential' }] };
    const productRecs = { add: [{ index: 0, rec: { brand: '', name: 'Old', price: '', retailer: '', url: '' } }], replace: [] };
    const m = model({ productAudit, productRecs });
    const result = await updateAnalysisSection(AID, 'audit', {
      productAudit: { add: [{ product: 'SPF', priority: 'essential', pick: { name: '' } }] },
    }, { analysisModel: m });
    expect(result.changed).toEqual(['productRecs']);
    expect(m.findByIdAndUpdate.mock.calls[0][1].$set).toEqual({ productRecs: null, productRecsEditedAt: null });
  });

  test('SR Ritual and shelf are written through their sanitizers; empty means "no section"', async () => {
    const m = model({ srProducts: { bundle_note: 'Old', era_hero_product: { sr_product_name: '', hero_reason: '' }, am: [], pm: [] } });
    const sr = await updateAnalysisSection(AID, 'sr', { srProducts: { bundle_note: '', am: [], pm: [] } }, { analysisModel: m });
    expect(sr).toMatchObject({ changed: ['srProducts'], action: 'sr_ritual_updated' });
    expect(m.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $set: { srProducts: null } });

    const m2 = model({ shelfAnalysis: null });
    const shelf = await updateAnalysisSection(AID, 'shelf', {
      shelfAnalysis: { identified_products: [{ product_name: 'Cleanser', status: 'compatible' }], shelf_summary: { overall_note: 'Ok' } },
    }, { analysisModel: m2 });
    expect(shelf).toMatchObject({ changed: ['shelfAnalysis'], action: 'shelf_updated' });
    expect(m2.findByIdAndUpdate.mock.calls[0][1].$set.shelfAnalysis.identified_products[0]).toMatchObject({ product_name: 'Cleanser', status: 'compatible' });
  });
});

// ---- T5: catalogue picker, score reading, safety ----------------------------------------
describe('updateAnalysisSection: catalogue product picker', () => {
  const { updateAnalysisSection } = require('./adminEdits');
  const AID = '64b000000000000000000001';
  const SAFE = 'a'.repeat(24);
  const AVOID = 'b'.repeat(24);
  const UNKNOWN = 'c'.repeat(24);
  // What loadCatalogue() returns: only ACTIVE home-use products, so an archived one is simply absent.
  const catalogue = [
    { _id: SAFE, name: 'Safe Peel', use: 'home', archived: false, pregnancy: 'safe', ingredients: 'aqua' },
    { _id: AVOID, name: 'Avoid Mask', use: 'home', archived: false, pregnancy: 'avoid', ingredients: 'aqua' },
  ];
  const PREGNANT = { pregnancy_caution: true, allergies: ['none'], irritants: ['none'] };
  const OPEN = { pregnancy_caution: false, allergies: ['none'], irritants: ['none'] };
  const model = current => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ userId: 'u1', quizAnswers: OPEN, ...current }) }) })),
    findByIdAndUpdate: jest.fn(async () => ({})),
  });
  const deps = (m, loader) => ({ analysisModel: m, catalogueLoader: loader || jest.fn(async () => catalogue) });
  const hero = (id, name = 'typed by hand') => ({ srProducts: { bundle_note: 'n', era_hero_product: { sr_product_id: id, sr_product_name: name, hero_reason: 'r' } } });

  test('an eligible pick saves and the server fills the name from the catalogue', async () => {
    const m = model({ srProducts: null });
    const result = await updateAnalysisSection(AID, 'sr', hero(SAFE, 'client typed name'), deps(m));
    expect(result).toMatchObject({ ok: true, action: 'sr_ritual_updated' });
    const { $set } = m.findByIdAndUpdate.mock.calls[0][1];
    expect($set.srProducts.era_hero_product).toMatchObject({ sr_product_id: SAFE, sr_product_name: 'Safe Peel' });
  });

  test('a product that pregnancy caution excludes is rejected and nothing is written', async () => {
    const m = model({ srProducts: null, quizAnswers: PREGNANT });
    await expect(updateAnalysisSection(AID, 'sr', hero(AVOID), deps(m)))
      .resolves.toEqual({ ok: false, code: 'analysis_product_ineligible' });
    expect(m.findByIdAndUpdate).not.toHaveBeenCalled();
    // ...while the pregnancy-safe product is still allowed for the same customer.
    await expect(updateAnalysisSection(AID, 'sr', hero(SAFE), deps(model({ srProducts: null, quizAnswers: PREGNANT }))))
      .resolves.toMatchObject({ ok: true });
  });

  test('an incomplete / unusable quiz means nothing is eligible', async () => {
    const m = model({ srProducts: null, quizAnswers: { pregnancy_caution: 'not a valid shape', allergies: 'oops' } });
    await expect(updateAnalysisSection(AID, 'sr', hero(SAFE), deps(m)))
      .resolves.toEqual({ ok: false, code: 'analysis_product_ineligible' });
  });

  test('unknown, archived (absent from the active list) and non-id values are rejected', async () => {
    for (const bad of [UNKNOWN, 'not-an-id']) {
      const m = model({ srProducts: null });
      await expect(updateAnalysisSection(AID, 'sr', hero(bad), deps(m))).resolves.toEqual({ ok: false, code: 'analysis_product_unknown' });
      expect(m.findByIdAndUpdate).not.toHaveBeenCalled();
    }
  });

  test('"No product" clears id and name; an SR step keeps its no_match_note', async () => {
    const current = { srProducts: { bundle_note: 'n', era_hero_product: { sr_product_id: SAFE, sr_product_name: 'Safe Peel', hero_reason: 'r' },
      am: [{ step: 1, routine_category: 'Cleanse', sr_product_id: SAFE, sr_product_name: 'Safe Peel', no_match_note: 'Any gentle cleanser' }], pm: [] } };
    const m = model(current);
    const loader = jest.fn(async () => catalogue);
    await updateAnalysisSection(AID, 'sr', { srProducts: {
      bundle_note: 'n', era_hero_product: { sr_product_id: '', sr_product_name: 'stale', hero_reason: 'r' },
      am: [{ routine_category: 'Cleanse', sr_product_id: '', sr_product_name: 'stale', no_match_note: 'Any gentle cleanser' }],
    } }, deps(m, loader));
    const { srProducts } = m.findByIdAndUpdate.mock.calls[0][1].$set;
    expect(srProducts.era_hero_product).toMatchObject({ sr_product_id: null, sr_product_name: '' });
    expect(srProducts.am[0]).toMatchObject({ sr_product_id: null, sr_product_name: '', no_match_note: 'Any gentle cleanser' });
    expect(loader).not.toHaveBeenCalled(); // clearing never needs the catalogue
  });

  test('a legacy value is kept with "keep:" and never touches the catalogue', async () => {
    const current = { srProducts: { bundle_note: 'n', era_hero_product: { sr_product_name: 'Old Serum', sr_product_id: 'admin-entered', hero_reason: 'r' }, am: [], pm: [] } };
    const m = model(current);
    const loader = jest.fn(async () => catalogue);
    const result = await updateAnalysisSection(AID, 'sr', hero('keep:admin-entered', 'Old Serum'), deps(m, loader));
    expect(result).toMatchObject({ ok: true, changed: [] }); // identical -> no write, no audit
    expect(m.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  test('"keep:" cannot smuggle in a catalogue id that is not already stored', async () => {
    await expect(updateAnalysisSection(AID, 'sr', hero('keep:' + AVOID), deps(model({ srProducts: null, quizAnswers: PREGNANT }))))
      .resolves.toEqual({ ok: false, code: 'analysis_product_unknown' });
  });

  test('an unchanged stored pick is not re-judged against eligibility', async () => {
    const current = { quizAnswers: PREGNANT, srProducts: { bundle_note: 'n', era_hero_product: { sr_product_name: 'Avoid Mask', sr_product_id: AVOID, hero_reason: 'r' }, am: [], pm: [] } };
    await expect(updateAnalysisSection(AID, 'sr', hero(AVOID, 'Avoid Mask'), deps(model(current)))).resolves.toMatchObject({ ok: true, changed: [] });
  });

  test('audit: the replace picker stores to_product_id + name; shelf: substitute and first purchase', async () => {
    const m = model({ productAudit: {}, productRecs: null });
    await updateAnalysisSection(AID, 'audit', { productAudit: { replace: [{ from: 'Toner', to_product_id: SAFE, to: 'x' }] } }, deps(m));
    expect(m.findByIdAndUpdate.mock.calls[0][1].$set.productAudit.replace[0]).toMatchObject({ from: 'Toner', to: 'Safe Peel', to_product_id: SAFE });

    const m2 = model({ shelfAnalysis: null });
    await updateAnalysisSection(AID, 'shelf', { shelfAnalysis: {
      identified_products: [{ product_name: 'Cleanser', sr_substitute_product_id: SAFE, sr_substitute_name: 'x' }],
      transition_plan: { first_sr_purchase_product_id: SAFE, first_sr_purchase: 'x' },
    } }, deps(m2));
    const shelf = m2.findByIdAndUpdate.mock.calls[0][1].$set.shelfAnalysis;
    expect(shelf.identified_products[0]).toMatchObject({ sr_substitute_product_id: SAFE, sr_substitute_name: 'Safe Peel' });
    expect(shelf.transition_plan).toMatchObject({ first_sr_purchase_product_id: SAFE, first_sr_purchase: 'Safe Peel' });
  });
});

describe('updateAnalysisSection: safety', () => {
  const { updateAnalysisSection } = require('./adminEdits');
  const AID = '64b000000000000000000001';
  const model = current => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ userId: 'u1', ...current }) }) })),
    findByIdAndUpdate: jest.fn(async () => ({})),
  });

  test('saves both lists (bounded) and audits as safety_updated', async () => {
    const m = model({ safetyFlags: ['Old'], checkInPrompts: null });
    const many = Array.from({ length: 40 }, (_, i) => 'Prompt ' + i);
    const result = await updateAnalysisSection(AID, 'safety', { safetyFlags: ['New', ' '], checkInPrompts: many }, { analysisModel: m });
    expect(result).toEqual({ ok: true, changed: ['safetyFlags', 'checkInPrompts'], action: 'safety_updated', userId: 'u1' });
    const { $set } = m.findByIdAndUpdate.mock.calls[0][1];
    expect($set.safetyFlags).toEqual(['New']);
    expect($set.checkInPrompts).toHaveLength(20);
  });

  test('unchanged (including an old analysis with no stored lists) writes nothing', async () => {
    const same = model({ safetyFlags: ['A'], checkInPrompts: ['B'] });
    expect((await updateAnalysisSection(AID, 'safety', { safetyFlags: ['A'], checkInPrompts: ['B'] }, { analysisModel: same })).changed).toEqual([]);
    const empty = model({ safetyFlags: null });
    expect((await updateAnalysisSection(AID, 'safety', { safetyFlags: [], checkInPrompts: [] }, { analysisModel: empty })).changed).toEqual([]);
    expect(same.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(empty.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('updateAnalysisSection: score reading', () => {
  const { updateAnalysisSection } = require('./adminEdits');
  const AID = '64b000000000000000000001';
  const SID = '64b0000000000000000000cc';
  const reading = () => ({
    startHere: { title: 'Start', body: 'Body text' },
    signals: [
      { key: 'barrier', potential: 90, weeks: '6-8 weeks', driver: 'Dry', why: 'Why one', lever: 'Lever one', shelf: { status: 'missing', text: 'No moisturiser' }, product: null },
      { key: 'clarity', potential: 85, weeks: '4 weeks', driver: null, why: 'Why two', lever: null, shelf: null, product: null },
    ],
  });
  const analysisModel = current => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ userId: 'u1', skinScanId: SID, ...current }) }) })),
    findByIdAndUpdate: jest.fn(async () => ({})),
  });
  const scanModel = scan => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => scan }) })),
    findByIdAndUpdate: jest.fn(async () => ({})),
  });
  const body = (over = {}) => ({
    startHere: { title: 'Start', body: 'Body text' },
    signals: [{ key: 'barrier', driver: 'Dry', why: 'Why one', lever: 'Lever one' }, { key: 'clarity', why: 'Why two' }],
    ...over,
  });
  const run = (b, scan) => {
    const sm = scanModel(scan);
    return updateAnalysisSection(AID, 'reading', b, { analysisModel: analysisModel({}), scanModel: sm }).then(r => ({ r, sm }));
  };

  test('merges edited text and keeps potential / weeks / shelf / product from the stored reading', async () => {
    // The scan has no scores, so sanitizeReading alone would null every "potential": they must survive anyway.
    const { r, sm } = await run(body({ startHere: { title: 'New title', body: 'Body text' } }), { _id: SID, userId: 'u1', reading: reading() });
    expect(r).toEqual({ ok: true, changed: ['startHere.title'], action: 'score_reading_updated', userId: 'u1' });
    const saved = sm.findByIdAndUpdate.mock.calls[0][1].$set.reading;
    expect(saved.startHere).toEqual({ title: 'New title', body: 'Body text' });
    expect(saved.signals[0]).toMatchObject({ key: 'barrier', potential: 90, weeks: '6-8 weeks', shelf: { status: 'missing', text: 'No moisturiser' }, product: null });
    expect(saved.signals[1]).toMatchObject({ key: 'clarity', potential: 85, why: 'Why two' });
  });

  test('a changed signal text is reported by field name only', async () => {
    const b = body();
    b.signals[0].why = 'A better reason';
    const { r } = await run(b, { _id: SID, userId: 'u1', reading: reading() });
    expect(r.changed).toEqual(['barrier.why']);
  });

  test('unchanged form writes nothing', async () => {
    const { r, sm } = await run(body(), { _id: SID, userId: 'u1', reading: reading() });
    expect(r.changed).toEqual([]);
    expect(sm.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('over-long text is rejected, not truncated', async () => {
    const b = body();
    b.signals[0].why = 'x'.repeat(401);
    const { r, sm } = await run(b, { _id: SID, userId: 'u1', reading: reading() });
    expect(r).toEqual({ ok: false, code: 'analysis_invalid_reading' });
    expect(sm.findByIdAndUpdate).not.toHaveBeenCalled();
    const tooLongTitle = await run(body({ startHere: { title: 'x'.repeat(81), body: 'b' } }), { _id: SID, userId: 'u1', reading: reading() });
    expect(tooLongTitle.r.code).toBe('analysis_invalid_reading');
  });

  test('a start-here with a title but no body is invalid', async () => {
    const { r } = await run(body({ startHere: { title: 'Only title', body: '' } }), { _id: SID, userId: 'u1', reading: reading() });
    expect(r.code).toBe('analysis_invalid_reading');
  });

  test('no reading, no scan, or a scan belonging to another user -> analysis_no_reading', async () => {
    expect((await run(body(), { _id: SID, userId: 'u1', reading: null })).r.code).toBe('analysis_no_reading');
    expect((await run(body(), null)).r.code).toBe('analysis_no_reading');
    const other = await run(body(), { _id: SID, userId: 'someone-else', reading: reading() });
    expect(other.r).toEqual({ ok: false, code: 'analysis_no_reading' });
    expect(other.sm.findByIdAndUpdate).not.toHaveBeenCalled();
    const noLink = await updateAnalysisSection(AID, 'reading', body(), { analysisModel: analysisModel({ skinScanId: null }), scanModel: scanModel(null) });
    expect(noLink.code).toBe('analysis_no_reading');
  });
});
