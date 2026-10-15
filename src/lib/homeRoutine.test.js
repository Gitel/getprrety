import { routineSteps, defaultRoutineTab, localDay, routineKeyFor, tickedIndices } from './homeRoutine';

const GENERIC = { am: [{ name: 'Cleanser', description: 'Lukewarm' }], pm: [{ name: 'Moisturizer', description: 'Pea-sized' }] };

describe('routineSteps', () => {
  test('uses the generic routine when there is no product routine (e.g. a fallback)', () => {
    expect(routineSteps({ routine: GENERIC }, 'am')).toEqual(GENERIC.am);
    expect(routineSteps({ routine: GENERIC, srProducts: null }, 'pm')).toEqual(GENERIC.pm);
  });

  test('the product routine replaces the generic steps for that tab', () => {
    const srProducts = {
      am: [
        { step: 1, routine_category: 'cleanser', sr_product_id: 'p1', sr_product_name: 'Gentle Wash', use_instruction: 'Massage 30s' },
        { step: 2, routine_category: 'spf', sr_product_id: null, no_match_note: 'Use any mineral SPF 30+' },
      ],
      pm: [],
    };
    expect(routineSteps({ routine: GENERIC, srProducts }, 'am')).toEqual([
      { name: 'Gentle Wash', description: 'Massage 30s', category: 'cleanser', productId: null }, // 'p1' is not a 24-hex id
      { name: 'spf', description: 'Use any mineral SPF 30+', productId: null },
    ]);
    // Empty product list for PM -> generic PM steps remain.
    expect(routineSteps({ routine: GENERIC, srProducts }, 'pm')).toEqual(GENERIC.pm);
  });

  test('an unmatched protect step keeps the generic SPF instruction even when its catalogue note is nonempty', () => {
    const analysis = {
      routine: { am: [{ category_id: 'protect', name: 'Sunscreen', description: 'Use broad-spectrum SPF 30+.' }], pm: [] },
      srProducts: { am: [{ category_id: 'protect', routine_category: 'Sunscreen', sr_product_id: null, no_match_note: 'No catalogue match.' }], pm: [] },
    };
    expect(routineSteps(analysis, 'am')).toEqual([
      { name: 'Sunscreen', description: 'Use broad-spectrum SPF 30+.', productId: null },
    ]);
  });

  test('productId is the sr_product_id only when it is a 24-hex catalogue id', () => {
    const hex = 'a'.repeat(24);
    const mk = id => ({ am: [{ routine_category: 'cleanser', sr_product_id: id, sr_product_name: 'X', use_instruction: 'Y', no_match_note: 'n' }], pm: [] });
    const idOf = id => routineSteps({ srProducts: mk(id) }, 'am')[0].productId;
    expect(idOf(hex)).toBe(hex);
    expect(idOf('admin-entered')).toBeNull();
    expect(idOf('sr-clean')).toBeNull();
    expect(idOf('A'.repeat(24))).toBeNull(); // uppercase is not a stored id
    expect(idOf(null)).toBeNull();
  });

  test('no analysis: no steps', () => {
    expect(routineSteps(null, 'am')).toEqual([]);
  });
});

describe('defaultRoutineTab', () => {
  test('follows the onboarding choice', () => {
    expect(defaultRoutineTab('morning', 22)).toBe('am');
    expect(defaultRoutineTab('night', 7)).toBe('pm');
  });

  test("'both' or unanswered: morning before noon, evening after", () => {
    expect(defaultRoutineTab('both', 11)).toBe('am');
    expect(defaultRoutineTab('both', 12)).toBe('pm');
    expect(defaultRoutineTab(null, 8)).toBe('am');
  });
});

test('localDay formats the local calendar day', () => {
  expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
});

describe('routineKeyFor', () => {
  test('is stable for the same routine and changes when the steps change', () => {
    const key = routineKeyFor(GENERIC.am, GENERIC.pm);
    expect(routineKeyFor(GENERIC.am, GENERIC.pm)).toBe(key);
    expect(routineKeyFor([{ name: 'Oil cleanse' }], GENERIC.pm)).not.toBe(key);
    expect(key.length).toBeLessThanOrEqual(8);
  });
});

test('tickedIndices extracts one tab, sorted, ignoring unticked steps', () => {
  expect(tickedIndices({ am2: true, am0: true, am1: false, pm0: true }, 'am')).toEqual([0, 2]);
  expect(tickedIndices({ am0: true }, 'pm')).toEqual([]);
});

// The tick key hashes step NAMES only. Adding productId to steps must not change it,
// otherwise every user's saved ticks for today would be thrown away after the update.
test('routineKeyFor ignores productId (key unchanged by the productId addition)', () => {
  const am = [{ name: 'Gentle Wash', description: 'd', category: 'cleanser' }];
  const pm = [{ name: 'Night Cream', description: 'd' }];
  const withIds = [{ ...am[0], productId: 'a'.repeat(24) }];
  expect(routineKeyFor(withIds, pm)).toBe(routineKeyFor(am, pm));
  expect(routineKeyFor(am, pm)).toBe('1719124d'); // value computed before the change
});
