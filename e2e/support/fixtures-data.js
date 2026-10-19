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

// Daniel's mockup (https://claude.ai/artifact/CuijSy9HdXJTCN7HTg9Vr3) as score-section data: its own
// numbers and copy, in the shape of SKIN_SCAN above. The shelf text is what the AI would send (plain
// text); the app adds the bold "Missing:" itself. Used by e2e/score-mockup.spec.js.
export const MOCKUP_SKIN_SCAN = {
  merged: null, fusion: null,
  signals: { overall: 76, skinAge: 37, skinType: 'combination', signals: [
    { key: 'barrier', name: 'Barrier & Moisture', score: 72, concerns: {} },
    { key: 'clarity', name: 'Clarity & Texture', score: 72, concerns: {} },
    { key: 'tone', name: 'Tone & Radiance', score: 77, concerns: {} },
    { key: 'resilience', name: 'Resilience', score: 76, concerns: {} },
  ] },
  reading: {
    startHere: { title: 'Wear SPF every morning',
      body: "One habit moves the most at once: it lifts your Tone & Radiance, protects your Resilience, and slows skin-age gain. It's also the one thing missing from your shelf." },
    signals: [
      { key: 'barrier', potential: 82, weeks: '6\u20138 weeks',
        driver: 'Your hydration reads low beneath a shiny surface \u2014 the barrier is doing the work but running dry.',
        why: 'You mentioned a cleanser but no moisturiser, and light water intake \u2014 both show up here.',
        lever: 'A ceramide + hyaluronic moisturiser, morning and night. Barrier first, always.',
        shelf: { status: 'missing', text: 'no moisturiser on your shelf \u2014 this is a core gap.' },
        product: { name: 'SR Barrier Repair Cream', actives: 'Ceramides \u00b7 Hyaluronic acid \u00b7 Squalane', url: 'https://example.test/p/barrier' } },
      { key: 'clarity', potential: 80, weeks: '8\u201312 weeks',
        driver: 'Pores read enlarged on the nose (58) while forehead and cheeks are clear \u2014 texture is uneven there.',
        why: 'Processed sugar and dairy can nudge oil and congestion upward over time.',
        lever: 'A niacinamide serum nightly, with gentle enzyme exfoliation weekly. Never a physical scrub.',
        shelf: { status: 'own', text: 'You already own a niacinamide serum \u2014 use it every night, this is your lever.' },
        product: { name: 'SR Pore Refining Serum', actives: 'Niacinamide 5% \u00b7 Zinc PCA', url: 'https://example.test/p/pore' } },
      { key: 'tone', potential: 85, weeks: '10\u201312 weeks',
        driver: 'Warm sun spots across the scalp and temples are what\u2019s holding radiance back \u2014 everything else is bright.',
        why: 'You said you rarely wear SPF. Sun exposure is cumulative \u2014 this is the main driver here.',
        lever: 'Daily SPF 30+ to prevent, vitamin C in the morning to gradually even what\u2019s there.',
        shelf: { status: 'missing', text: 'no SPF or vitamin C \u2014 the highest-impact additions you can make.' },
        product: { name: 'SR Vitamin C Brightening Fluid', actives: '15% Vitamin C \u00b7 Ferulic acid', url: 'https://example.test/p/vitc' } },
      { key: 'resilience', potential: 82, weeks: '12+ weeks',
        driver: 'Firmness is strong (85). Early expression lines on the forehead and between the brows are the only softening.',
        why: 'Expression lines deepen with sun and time \u2014 the good news is firmness gives you a strong base.',
        lever: 'A low-strength retinoid in the evening, introduced gradually. Rebuilds over months, not days.',
        shelf: { status: 'missing', text: 'no retinoid \u2014 add last, once your barrier is steady.' },
        product: { name: 'SR Gentle Retinal 0.05%', actives: 'Retinaldehyde \u00b7 Peptides', url: 'https://example.test/p/retinal' } },
    ] },
  readingStatus: 'ready',
};

// Catalogue ids used by the fixture analysis. 24-hex like real Mongo ids: the app only asks the
// catalogue for ids that match /^[a-f0-9]{24}$/ (old ids such as "sr-clean" are ignored).
export const PID = {
  cleanser: '64b0000000000000000000a1',  // photo + price, NO shop link (-> no Buy button)
  moisturizer: '64b0000000000000000000a2', // photo + price + https shop link (-> Buy button)
  serum: '64b0000000000000000000a3',     // no photo, no price, no shop link (text-only card)
  archived: '64b0000000000000000000a4',  // archived, still has photo/price/link (-> "No longer available", no Buy)
};

// The fake shop host the mock serves (see CHECKOUT_HOST in mock-api.js), so a Buy tap that opens
// the link loads a tiny page instead of being counted as a blocked host.
export const SHOP_URL = 'https://shop.e2e.test/products/barrier-repair-cream';

// What GET /api/catalogue/products?ids= returns per product (contract section 1). The mock answers
// in the order of the requested ids and leaves unknown ids out.
export const CATALOGUE = [
  { id: PID.cleanser, name: 'Gentle Gel Cleanser', category: 'cleansers_peelings', keyActives: ['glycerin', 'panthenol'], price: 18, shopUrl: null, hasPhoto: true, photoVersion: 1700000000001, archived: false },
  { id: PID.moisturizer, name: 'Barrier Repair Cream', category: 'face_creams', keyActives: ['ceramides', 'squalane'], price: 24, shopUrl: SHOP_URL, hasPhoto: true, photoVersion: 1700000000002, archived: false },
  { id: PID.serum, name: 'Hydra Calm Serum', category: 'serums', keyActives: ['hyaluronic_acid'], price: null, shopUrl: null, hasPhoto: false, photoVersion: 1700000000003, archived: false },
  { id: PID.archived, name: 'Retired Calming Toner', category: 'toners', keyActives: ['centella'], price: 15, shopUrl: 'https://shop.e2e.test/products/retired-toner', hasPhoto: true, photoVersion: 1700000000004, archived: true },
];

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
    // `to` is the catalogue name restored by the server; `to_product_id` is its stable catalogue id.
    replace: [{ from: 'Foaming cleanser', to: 'Gentle Gel Cleanser', to_product_id: PID.cleanser, reason: 'The current one leaves skin tight.' }],
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
  // The product-matched routine, in the shape the analysis pipeline returns after hydration
  // (server/services/anthropic/analysisContract.js srStep + compact.js hydrateCompactOutput):
  // catalogue ids, category_id, and for an UNMATCHED step sr_product_id null + sr_product_name ''
  // + a no_match_note. Home and Profile prefer it over `routine` (homeRoutine.js).
  srProducts: {
    bundle_note: 'A three-step barrier bundle covers your whole routine.',
    era_hero_product: {
      sr_product_id: PID.moisturizer, sr_product_name: 'Barrier Repair Cream',
      hero_reason: 'The one product that moves your era the most.',
    },
    am: [
      {
        step: 1, category_id: 'cleanse', routine_category: 'Cleanser', sr_product_id: PID.cleanser, sr_product_name: 'Gentle Gel Cleanser',
        key_actives_matched: ['glycerin', 'panthenol', 'oat_extract'],
        use_instruction: 'Massage onto damp skin, rinse with lukewarm water.',
        match_reason: 'Sulfate free and pH balanced for a stressed barrier.', no_match_note: '',
      },
      {
        step: 2, category_id: 'moisturize', routine_category: 'Moisturizer', sr_product_id: PID.moisturizer, sr_product_name: 'Barrier Repair Cream',
        key_actives_matched: ['ceramides', 'squalane'],
        use_instruction: 'Apply a pea-sized amount to face and neck.',
        match_reason: 'Rebuilds the lipid barrier.', no_match_note: '',
      },
      {
        step: 3, category_id: 'protect', routine_category: 'Sunscreen', sr_product_id: null, sr_product_name: '',
        key_actives_matched: [], use_instruction: '', match_reason: '',
        no_match_note: 'Use your own mineral SPF 30+ as the last morning step.',
      },
    ],
    pm: [
      {
        step: 1, category_id: 'cleanse', routine_category: 'Cleanser', sr_product_id: PID.cleanser, sr_product_name: 'Gentle Gel Cleanser',
        key_actives_matched: ['glycerin'],
        use_instruction: 'Double cleanse if you wore sunscreen.',
        match_reason: 'Removes the day without stripping.', no_match_note: '',
      },
      {
        step: 2, category_id: 'treat', routine_category: 'Treatment', sr_product_id: PID.serum, sr_product_name: 'Hydra Calm Serum',
        key_actives_matched: ['hyaluronic_acid', 'centella'],
        use_instruction: 'Press into slightly damp skin.',
        match_reason: 'Calms redness and restores water.', no_match_note: '',
      },
      {
        step: 3, category_id: 'moisturize', routine_category: 'Moisturizer', sr_product_id: PID.moisturizer, sr_product_name: 'Barrier Repair Cream',
        key_actives_matched: ['ceramides'],
        use_instruction: 'Apply generously as the last step.',
        match_reason: 'Overnight is when skin rebuilds most.', no_match_note: '',
      },
    ],
  },
  shelfAnalysis: {
    shelf_summary: { overall_note: 'Three of your five products work well together; one conflicts.' },
    identified_products: [
      {
        brand: 'Acme', product_name: 'Foaming Cleanser', category: 'cleanser', status: 'conflicting',
        status_reason: 'Sulfates are too harsh for your barrier.',
        use_instruction: 'Stop using for now.', sr_substitute_name: 'Gentle Gel Cleanser', sr_substitute_product_id: PID.cleanser,
      },
      {
        brand: 'Acme', product_name: 'Mineral Sunscreen SPF 30', category: 'sunscreen', status: 'compatible',
        status_reason: 'Gentle and broad spectrum.', use_instruction: 'Every morning.',
        sr_substitute_name: '', sr_substitute_product_id: null,
      },
      {
        brand: 'Acme', product_name: 'Salicylic Toner', category: 'toner', status: 'borderline',
        status_reason: 'Fine once a week, too strong daily.', use_instruction: 'Use twice a week at most.',
        sr_substitute_name: '', sr_substitute_product_id: null,
      },
    ],
    transition_plan: { first_sr_purchase: 'Barrier Repair Cream', first_sr_purchase_product_id: PID.moisturizer },
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

// In-app booking (GET /api/bookings/slots). Clinic-local times (Asia/Jerusalem, UTC+3 in October):
// Thu 2026-10-01 10:00 / 10:30 / 11:00 and Sun 2026-10-04 10:00 / 10:30. `date` and `time` are the
// clinic wall clock, `startsAt` / `endsAt` are UTC ISO strings (slots are 30 minutes long).
const slot = (startsAt, endsAt, date, time) => ({ startsAt, endsAt, date, time });
export const BOOKING_SLOTS = [
  slot('2026-10-01T07:00:00.000Z', '2026-10-01T07:30:00.000Z', '2026-10-01', '10:00'),
  slot('2026-10-01T07:30:00.000Z', '2026-10-01T08:00:00.000Z', '2026-10-01', '10:30'),
  slot('2026-10-01T08:00:00.000Z', '2026-10-01T08:30:00.000Z', '2026-10-01', '11:00'),
  slot('2026-10-04T07:00:00.000Z', '2026-10-04T07:30:00.000Z', '2026-10-04', '10:00'),
  slot('2026-10-04T07:30:00.000Z', '2026-10-04T08:00:00.000Z', '2026-10-04', '10:30'),
];

// Times the clinic OFFERS but that cannot be booked (busy calendar, a confirmed booking or a hold).
// GET /api/bookings/slots returns them in `taken` (same shape as BOOKING_SLOTS, UTC = clinic - 3h):
//   - Thu 2026-10-01 11:30 and 12:00 (that day also has free 10:00 / 10:30 / 11:00),
//   - Sun 2026-10-04 11:00 (free 10:00 / 10:30),
//   - Mon 2026-10-05 10:00 and 10:30: NO free time that day, so it is a "fully booked" day.
export const BOOKING_TAKEN = [
  slot('2026-10-01T08:30:00.000Z', '2026-10-01T09:00:00.000Z', '2026-10-01', '11:30'),
  slot('2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', '2026-10-01', '12:00'),
  slot('2026-10-04T08:00:00.000Z', '2026-10-04T08:30:00.000Z', '2026-10-04', '11:00'),
  slot('2026-10-05T07:00:00.000Z', '2026-10-05T07:30:00.000Z', '2026-10-05', '10:00'),
  slot('2026-10-05T07:30:00.000Z', '2026-10-05T08:00:00.000Z', '2026-10-05', '10:30'),
];

// An already confirmed upcoming consultation (GET /api/bookings/mine -> upcoming).
export const BOOKING_UPCOMING = {
  id: 'booking-1', startsAt: '2026-10-04T07:00:00.000Z', endsAt: '2026-10-04T07:30:00.000Z',
  date: '2026-10-04', time: '10:00', status: 'confirmed', note: '',
};
