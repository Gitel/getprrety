const { DEFAULTS, KEYS, BOUNDS, assembleSystem } = require('./defaults');
const { COMPACT_SYSTEM_INSTRUCTIONS } = require('../anthropic/compact');
const { prepareSkinRequest } = require('../anthropic/skinRequest');

// The three prompts exactly as they were hard-coded BEFORE the locked/guidance split.
// The tests below prove the default assembly still contains every one of their sentences.
const ORIGINAL_SKIN_PROMPT = "You are producing a cautious, cosmetic skin-care education summary. Follow the supplied JSON Schema exactly and return only one JSON object with no markdown or extra keys.\n\nWrite user-facing prose in the requested language (English or Hebrew). Keep catalogue product names exactly as supplied. Stable IDs, verdicts, statuses, category IDs, and catalogue category enums stay in schema form; translate display labels and explanations. Never invent catalogue IDs, product names, ingredients, prices, or URLs.\n\nUse only supplied quiz answers. Do not repeat identifying details or fill gaps with assumptions. Do not diagnose, claim that a photo proves a condition, promise results, or prescribe treatment. Describe visible features as tentative observations. First assess framing and image quality. If an image is partial, off-center, blurred, poorly lit, occluded, or otherwise uncertain, say in both the summary and `safety_flags` that the photo is insufficient; do not infer details. Do not imply missing angles were provided or that the available views are complete. Without skin photos make no visual observations; without shelf photos set `shelfAnalysis` to null.\n\nKeep routines concise: at most four simple steps per period. Start with cleansing; place optional treatment before moisturizing. The basic AM routine includes cleansing, moisturizing, and daytime sun protection, with protection last; the basic PM routine includes cleansing and moisturizing. Do not turn sleep, water, food, exercise, or other lifestyle advice into a product or routine step. Avoid duplicate categories within a period. Generic routine `category_id` values and SR routine `category_id` values use the same stable enum; localized `category` and `routine_category` strings are display labels. If `srProducts` is non-null, its AM and PM category IDs and order must exactly cover the corresponding generic routine, including cleanser and daytime protection. Number each SR step sequentially from 1 to match its position. The saved `cleansers_peelings` category contains both peel products and a cleanser; only use a product as a cleanser when its supplied name explicitly says `cleanser` or `cleansing`. Otherwise leave the SR cleanser unmatched. Represent an unmatched cleanser or sunscreen with a null ID, an empty product name, and a specific `no_match_note` explaining that no eligible catalogue match exists. The catalogue has no verified numeric SPF field, so every SR protection step must stay unmatched even if a product name suggests sun protection. Never omit that step or infer SPF from a name to make the catalogue appear complete.\n\nOnly select supplied catalogue products with `use: home`, non-archived status, and exact supplied IDs and names. When pregnancy/trying to conceive/breastfeeding caution is present, only `pregnancy: safe` items are eligible. The request may exclude products because a reported allergy or irritant could not be checked; respect `product_selection_limitations` and do not choose excluded items. Broad answers such as cosmetics, foods, medicines, or sunscreen do not identify a specific ingredient, so do not make catalogue product picks when that limitation is present. Unrecognized free-text allergy or irritant labels also prevent confident catalogue selection; respect the supplied limitation rather than treating an unmapped label as clear. If a reported specific allergy or irritant has no ingredient list to compare, leave the item unmatched. Never claim allergy safety. Avoid ingredients that clearly match a reported allergy or irritant. Interpret ingredient classes conservatively: acids means the listed exfoliating acids (including citric acid), not every ingredient whose name contains acid; hyaluronic acid and ascorbic acid are not automatically AHAs. Unknown foods, medicines, or broad cosmetic categories cannot be mapped to ingredient safety.\n\nFor every product-audit item, use `keep`, `remove`, `missing`, or `replace` clearly. `keep`, `remove`, and `missing` require both replacement fields to be null. `replace` requires an exact known catalogue ID and its matching name; when none is eligible, do not use `replace`. Keep `most_urgent_gap` as a missing need/category, never an invented product. Keep current-product audit empty if there is no useful evidence. Include relevant safety flags, without suppressing a caution for brevity. If no event was supplied, set `event_prep` to null.\n\nFace photos are private evaluation inputs, not product photos. Shelf photos support cautious package identification only, never medical diagnosis. Use image angle labels and do not identify a product from packaging color alone. Mark uncertain shelf identification as `unknown`. Match SR moisturize steps only to supplied `face_creams` products; otherwise leave the product unmatched. Keep user-facing prose compact: use 1\u20132 sentences for the summary and one short sentence for each insight, routine instruction, audit note, match reason, and safety flag. Avoid repeating the same caution while preserving every distinct safety concern.\n";
const ORIGINAL_SCORE_READING = 'Write concise, supportive score-reading copy in English using only supplied quiz and score data. Never diagnose or promise a score change. Only mention a product whose exact name and ingredients appear in eligible_catalogue; otherwise set product to null. Never invent a product URL. Return start_here and signals in the required JSON shape.';
const ORIGINAL_MARKET_PICKS = 'Recommend reputable skincare products sold in the requested country. Avoid products whose ingredients conflict with the supplied allergies, irritants, or pregnancy caution. Product ingredient lists are not supplied, so never claim a recommendation is allergy-safe or pregnancy-safe; if safety cannot be assessed, return an empty list for that item. Use only HTTPS URLs and return the requested strict JSON object.';

// Split into sentences at ". " / "? " / "! " (and paragraph breaks); backticks stay inside a sentence.
const sentences = text => text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

describe('defaults keep today\'s prompts', () => {
  test('skin_analysis: the assembled default contains every sentence of the original prompt, compact rules last', () => {
    const assembled = assembleSystem('skin_analysis', DEFAULTS.skin_analysis.defaultGuidance);
    const original = sentences(ORIGINAL_SKIN_PROMPT);
    expect(original.length).toBeGreaterThan(20);
    for (const sentence of original) expect(assembled).toContain(sentence);
    expect(assembled.endsWith(COMPACT_SYSTEM_INSTRUCTIONS)).toBe(true);
    // The locked part starts the prompt; the moved persona sentence now sits under the guidance heading.
    expect(assembled.startsWith('Follow the supplied JSON Schema exactly')).toBe(true);
    expect(assembled).toContain('\n\nClinic guidance:\nYou are producing a cautious, cosmetic skin-care education summary.');
  });

  test('skin_analysis: the locked file no longer holds the guidance sentences', () => {
    expect(DEFAULTS.skin_analysis.lockedRules).not.toContain('You are producing a cautious');
    expect(DEFAULTS.skin_analysis.lockedRules).not.toContain('Keep user-facing prose compact');
  });

  test('score_reading: preserves format and safety rules while adding catalogue-first generic fallback', () => {
    const assembled = assembleSystem('score_reading', DEFAULTS.score_reading.defaultGuidance, 'en');
    const [first, ...rest] = sentences(ORIGINAL_SCORE_READING);
    // The former catalogue-only sentence now explicitly allows controlled generic fallbacks.
    for (const sentence of rest.filter(s => !s.startsWith('Only mention a product'))) expect(assembled).toContain(sentence);
    expect(assembled).toContain('first assess eligible_catalogue');
    expect(assembled).toContain('use an exact generic product type from generic_product_types');
    expect(first).toBe('Write concise, supportive score-reading copy in English using only supplied quiz and score data.');
    expect(assembled).toContain('Write concise, supportive score-reading copy.');
    expect(assembled).toContain('English using only supplied quiz and score data.');
  });

  test('score_reading: the language line follows the scan language', () => {
    expect(assembleSystem('score_reading', '', 'he')).toContain('in Hebrew using only supplied quiz and score data.');
    expect(assembleSystem('score_reading', '', 'en')).toContain('in English using');
    expect(assembleSystem('score_reading', '', 'he')).not.toContain('{language}');
  });

  test('market_picks: the assembled default contains every sentence of the original prompt', () => {
    const assembled = assembleSystem('market_picks', DEFAULTS.market_picks.defaultGuidance);
    for (const sentence of sentences(ORIGINAL_MARKET_PICKS)) expect(assembled).toContain(sentence);
  });

  test('prepareSkinRequest without guidance uses the default guidance (tools/anthropic-eval behaviour)', () => {
    const request = prepareSkinRequest({ quiz: {}, language: 'en', images: [], catalogue: [] });
    expect(request.system).toBe(assembleSystem('skin_analysis', DEFAULTS.skin_analysis.defaultGuidance));
  });
});

describe('assembleSystem', () => {
  test('locked rules first, guidance under a heading, nothing extra for empty guidance', () => {
    const withGuidance = assembleSystem('market_picks', 'Prefer budget brands.');
    expect(withGuidance.startsWith(DEFAULTS.market_picks.lockedRules)).toBe(true);
    expect(withGuidance.endsWith('\n\nClinic guidance:\nPrefer budget brands.')).toBe(true);
    expect(assembleSystem('market_picks', '')).toBe(DEFAULTS.market_picks.lockedRules);
    expect(assembleSystem('market_picks', '   \n ')).toBe(DEFAULTS.market_picks.lockedRules);
    expect(assembleSystem('market_picks', null)).toBe(DEFAULTS.market_picks.lockedRules);
  });

  test('skin_analysis keeps the compact rules after the guidance', () => {
    const system = assembleSystem('skin_analysis', 'Custom tone.');
    expect(system.indexOf('Clinic guidance:\nCustom tone.')).toBeLessThan(system.indexOf(COMPACT_SYSTEM_INSTRUCTIONS));
    expect(system.endsWith(COMPACT_SYSTEM_INSTRUCTIONS)).toBe(true);
  });

  test('an unknown key throws (programming error)', () => {
    expect(() => assembleSystem('nope', '')).toThrow();
  });
});

describe('defaults table', () => {
  test('keys, titles and default limits match the contract / current code values', () => {
    expect(KEYS).toEqual(['skin_analysis', 'score_reading', 'market_picks']);
    expect(DEFAULTS.skin_analysis).toMatchObject({ title: 'Skin analysis', defaultLimits: { timeoutSec: 90, maxOutputTokens: 8000, maxCostUsd: 0.25 } });
    expect(DEFAULTS.score_reading).toMatchObject({ title: 'Score reading', defaultLimits: { timeoutSec: 90, maxOutputTokens: 2000, maxCostUsd: 0.25 } });
    expect(DEFAULTS.market_picks).toMatchObject({ title: 'Market picks', defaultLimits: { timeoutSec: 90, maxOutputTokens: 1000, maxCostUsd: 0.25 } });
  });

  test('default limits are inside the bounds', () => {
    for (const key of KEYS) {
      const { timeoutSec, maxOutputTokens, maxCostUsd } = DEFAULTS[key].defaultLimits;
      expect(timeoutSec).toBeGreaterThanOrEqual(BOUNDS.timeoutSec.min);
      expect(timeoutSec).toBeLessThanOrEqual(BOUNDS.timeoutSec.max);
      expect(maxOutputTokens).toBeGreaterThanOrEqual(BOUNDS.maxOutputTokens.min);
      expect(maxOutputTokens).toBeLessThanOrEqual(BOUNDS.maxOutputTokens.max);
      expect(maxCostUsd).toBeGreaterThanOrEqual(BOUNDS.maxCostUsd.min);
      expect(maxCostUsd).toBeLessThanOrEqual(BOUNDS.maxCostUsd.max);
    }
  });

  test('timeout and token defaults match the constants the provider client uses today', () => {
    const client = require('../anthropic/client');
    expect(DEFAULTS.skin_analysis.defaultLimits.timeoutSec * 1000).toBe(client.TIMEOUT_MS);
    expect(DEFAULTS.skin_analysis.defaultLimits.maxOutputTokens).toBe(client.MAX_OUTPUT_TOKENS);
    expect(DEFAULTS.skin_analysis.defaultLimits.maxCostUsd).toBe(client.MAX_REPORTED_COST_USD);
  });
});
