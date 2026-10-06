// Fixture data served by the mock API (see mock-api.js).
//
// Everything here is plain, invented data (no real people, no secrets). Times are fixed
// ISO strings so every run shows the same text. The browser clock STARTS at
// 2026-09-29 09:00 UTC and keeps running (see page-init.js), so:
//   - the saved analysis is from 2026-09-29 07:00 and the user's first reading is from
//     2026-09-15, which the Profile score section shows as "Day 15";
//   - the clinic message times are earlier the same week.

// The one token the mock treats as "signed in". The e2e page init seeds it into localStorage
// (Capacitor Preferences key "CapacitorStorage.gp_token") for signed-in scenarios.
export const TOKEN = 'e2e-token';

export const TODAY = '2026-09-29';

// The signed-in user. `skincareTiming: 'morning'` makes Home open on the AM tab.
// Both `id` and `_id` exist because /api/auth/me returns the raw document (`_id`) while
// login/signup return the public shape (`id`).
export const USER = {
  _id: 'user-1',
  id: 'user-1',
  firstName: 'Dana',
  email: 'dana@example.test',
  termsAcceptedAt: '2026-09-15T08:00:00.000Z',
  consentVersion: 'v1',
  skincareTiming: 'morning',
};

// The same user before the SkinTiming onboarding screen (no skincareTiming): use with
// mock.set({ user: FIRST_TIME_USER }).
export const FIRST_TIME_USER = { ...USER, skincareTiming: null };

// Copy of the "Barrier Healing Era" object from src/constants.js (ERAS.barrier_healing).
const ERA = {
  id: 'barrier_healing',
  emoji: '\u{1F33F}',
  name: 'Barrier Healing Era',
  tagline: 'Your skin is not broken ' + String.fromCharCode(0x2014) + " it's asking for gentleness.",
  affirmation: 'I give my skin permission to heal at its own pace.',
  color: '#7A9E6E',
  bg: '#F2F6EF',
};

// The score-section data of a finished PerfectCorp scan, in the shape of
// server/services/skinScan/scanView.js: { signals, reading, readingStatus }.
// `reading` is the written copy from Railway; readingStatus 'ready' makes the four signal
// cards expandable and shows the "Start here" card.
export const SKIN_SCAN = {
  merged: null,
  fusion: null,
  signals: {
    overall: 72,
    skinAge: 31,
    skinType: 'combination',
    signals: [
      { key: 'barrier', name: 'Barrier & Moisture', score: 58, concerns: { moisture: 55, oiliness: 61 } },
      { key: 'clarity', name: 'Clarity & Texture', score: 74, concerns: { pore: 70, texture: 76, acne: 76 } },
      { key: 'tone', name: 'Tone & Radiance', score: 69, concerns: { radiance: 66, redness: 70, age_spot: 71 } },
      { key: 'resilience', name: 'Resilience', score: 81, concerns: { wrinkle: 83, firmness: 79 } },
    ],
  },
  reading: {
    startHere: {
      title: 'Add a ceramide moisturizer at night',
      body: 'Your moisture score is the lowest of the four. A barrier cream every evening is the single change that lifts the most.',
    },
    signals: [
      {
        key: 'barrier', potential: 78, weeks: '6-8 weeks',
        driver: 'Moisture is low and your skin is losing water faster than it can hold it.',
        why: 'You said your skin feels tight 30 minutes after cleansing.',
        lever: 'A ceramide cream at night and a gentler cleanser.',
        shelf: { status: 'miss', text: 'You do not own a barrier cream yet.' },
        product: { name: 'Ceramide Barrier Cream', actives: 'Ceramides, glycerin, squalane', url: 'https://example.test/products/ceramide-cream' },
      },
      {
        key: 'clarity', potential: 84, weeks: '8-10 weeks',
        driver: 'Enlarged pores in the T-zone.',
        why: 'You mentioned pores and mild breakouts.',
        lever: 'A weekly BHA exfoliant.',
        shelf: { status: 'own', text: 'Your salicylic toner already does this.' },
        product: null,
      },
      {
        key: 'tone', potential: 80, weeks: '10-12 weeks',
        driver: 'Mild redness on the cheeks.',
        why: 'Sun and heat are listed as triggers.',
        lever: 'Daily SPF 30+.',
        shelf: null,
        product: null,
      },
      {
        key: 'resilience', potential: 88, weeks: '12+ weeks',
        driver: 'Fine lines around the eyes.',
        why: 'Based on your age and sleep answers.',
        lever: 'A gentle retinoid, once the barrier is calm.',
        shelf: null,
        product: null,
      },
    ],
  },
  readingStatus: 'ready',
};

// A saved analysis as GET /api/analysis/latest returns it. It exercises every block of the
// Home and Profile screens: era, analysis text, insights, product audit (keep / remove /
// replace / add), generic routine, affirmation, the SR product routine (AM and PM, with
// one step that has no matching product), the shelf audit and the skin scan.
export const ANALYSIS = {
  _id: 'analysis-1',
  createdAt: '2026-09-29T07:00:00.000Z',
  firstReadingAt: '2026-09-15T08:00:00.000Z',
  eraId: 'barrier_healing',
  era: ERA,
  source: 'gemini',
  skinAnalysis: 'Your skin shows the signs of a stressed moisture barrier: tightness after cleansing, mild redness and uneven texture in the T-zone. The good news is that a simple, gentle routine can calm this within a few weeks.',
  keyInsights: [
    'Barrier first: Calm the barrier before adding any strong actives.',
    'Cleansing: Your current cleanser is stripping more than it should.',
    'Sun protection: A daily SPF is the most important anti-aging step for you.',
  ],
  productAudit: {
    keep: [{ product: 'Mineral sunscreen', reason: 'Gentle and effective, keep using it every morning.' }],
    remove: [{ product: 'Foaming scrub', reason: 'Physical scrubs damage a stressed barrier.' }],
    replace: [{ from: 'Foaming cleanser', to: 'Gentle gel cleanser', reason: 'The current one leaves skin tight.' }],
    add: [
      { product: 'Ceramide moisturizer', reason: 'Most urgent addition for your era', priority: 'essential' },
      { product: 'Hydrating serum', reason: 'Adds water back into the skin.', priority: 'recommended' },
    ],
  },
  routine: {
    am: [
      { name: 'Gentle cleanser', description: 'Massage for 30 seconds with lukewarm water.' },
      { name: 'Hydrating serum', description: 'Apply to damp skin.' },
      { name: 'Mineral SPF 30+', description: 'Finish every morning without fail.' },
    ],
    pm: [
      { name: 'Oil cleanse', description: 'Dissolve SPF and daily buildup.' },
      { name: 'Barrier repair cream', description: 'Apply generously before bed.' },
    ],
  },
  affirmation: 'I give my skin permission to heal at its own pace.',
  // The product-matched routine. Home and Profile prefer it over `routine` (homeRoutine.js).
  srProducts: {
    bundle_note: 'A three-step barrier bundle covers your whole routine.',
    era_hero_product: {
      sr_product_name: 'Barrier Repair Cream',
      hero_reason: 'The one product that moves your era the most.',
    },
    am: [
      {
        step: 1, routine_category: 'Cleanser', sr_product_id: 'sr-clean', sr_product_name: 'Gentle Gel Cleanser',
        key_actives_matched: ['glycerin', 'panthenol', 'oat_extract'],
        use_instruction: 'Massage onto damp skin, rinse with lukewarm water.',
        match_reason: 'Sulfate free and pH balanced for a stressed barrier.',
      },
      {
        step: 2, routine_category: 'Moisturizer', sr_product_id: 'sr-moist', sr_product_name: 'Barrier Repair Cream',
        key_actives_matched: ['ceramides', 'squalane'],
        use_instruction: 'Apply a pea-sized amount to face and neck.',
        match_reason: 'Rebuilds the lipid barrier.',
      },
      {
        step: 3, routine_category: 'Sunscreen', sr_product_id: null, sr_product_name: null,
        no_match_note: 'Use your own mineral SPF 30+ as the last morning step.',
      },
    ],
    pm: [
      {
        step: 1, routine_category: 'Cleanser', sr_product_id: 'sr-clean', sr_product_name: 'Gentle Gel Cleanser',
        key_actives_matched: ['glycerin'],
        use_instruction: 'Double cleanse if you wore sunscreen.',
        match_reason: 'Removes the day without stripping.',
      },
      {
        step: 2, routine_category: 'Treatment', sr_product_id: 'sr-serum', sr_product_name: 'Hydra Calm Serum',
        key_actives_matched: ['hyaluronic_acid', 'centella'],
        use_instruction: 'Press into slightly damp skin.',
        match_reason: 'Calms redness and restores water.',
      },
      {
        step: 3, routine_category: 'Moisturizer', sr_product_id: 'sr-moist', sr_product_name: 'Barrier Repair Cream',
        key_actives_matched: ['ceramides'],
        use_instruction: 'Apply generously as the last step.',
        match_reason: 'Overnight is when skin rebuilds most.',
      },
    ],
  },
  shelfAnalysis: {
    shelf_summary: { overall_note: 'Three of your five products work well together; one conflicts.' },
    identified_products: [
      {
        brand: 'Acme', product_name: 'Foaming Cleanser', category: 'cleanser', status: 'conflicting',
        status_reason: 'Sulfates are too harsh for your barrier.',
        use_instruction: 'Stop using for now.', sr_substitute_name: 'Gentle Gel Cleanser',
      },
      {
        brand: 'Acme', product_name: 'Mineral Sunscreen SPF 30', category: 'sunscreen', status: 'compatible',
        status_reason: 'Gentle and broad spectrum.', use_instruction: 'Every morning.',
      },
      {
        brand: 'Acme', product_name: 'Salicylic Toner', category: 'toner', status: 'borderline',
        status_reason: 'Fine once a week, too strong daily.', use_instruction: 'Use twice a week at most.',
      },
    ],
    transition_plan: { first_sr_purchase: 'Barrier Repair Cream' },
  },
  skinScanId: 'scan-1',
  skinScan: SKIN_SCAN,
};

// What POST /api/ai/product-recommendations returns (Profile, signed-in users): one pick
// per audit "replace" / "add" item, matched by `index`.
export const PRODUCT_RECS = {
  replace: [{ index: 0, rec: { brand: 'Acme', name: 'Gentle Gel Cleanser', price: '$18', retailer: 'Example Store', url: 'https://example.test/cleanser', category: 'cleanser' } }],
  add: [
    { index: 0, rec: { brand: 'Acme', name: 'Ceramide Moisturizing Cream', price: '$24', retailer: 'Example Store', url: 'https://example.test/cream', category: 'moisturizer' } },
    { index: 1, rec: { brand: 'Acme', name: 'Hydra Calm Serum', price: '$32', retailer: 'Example Store', url: 'https://example.test/serum', category: 'serum' } },
  ],
};

// The message thread, oldest first. One unread clinic message (readAt null) gives Home's
// message badge a "1".
export const MESSAGES = [
  { id: 'm1', from: 'admin', body: 'Hi Dana, welcome! Tell us if anything in your routine feels irritating.', createdAt: '2026-09-25T10:00:00.000Z', readAt: '2026-09-25T10:05:00.000Z' },
  { id: 'm2', from: 'user', body: 'Thank you! The new cleanser feels much gentler.', createdAt: '2026-09-25T10:30:00.000Z', readAt: null },
  { id: 'm3', from: 'admin', body: 'Great to hear. Your consultation is confirmed for next week.', createdAt: '2026-09-28T15:20:00.000Z', readAt: null },
];

// Suggestions for the quiz "city" question (/api/cities/autocomplete).
export const CITIES = [
  { city: 'Tel Aviv, Israel', country: 'IL', lat: 32.0853, lng: 34.7818, timezone: 'Asia/Jerusalem' },
  { city: 'Tel Mond, Israel', country: 'IL', lat: 32.2544, lng: 34.9189, timezone: 'Asia/Jerusalem' },
];

// Routine progress for today (Home ticks). Its routineKey must equal the key the app
// computes for the SR routine above (src/lib/homeRoutine.js routineKeyFor); the mock
// computes it the same way, see routineKeyFor() in mock-api.js.
export const PROGRESS_TICKS = { am: [0], pm: [] };
