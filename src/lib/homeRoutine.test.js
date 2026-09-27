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
      { name: 'Gentle Wash', description: 'Massage 30s', category: 'cleanser' },
      { name: 'spf', description: 'Use any mineral SPF 30+' },
    ]);
    // Empty product list for PM -> generic PM steps remain.
    expect(routineSteps({ routine: GENERIC, srProducts }, 'pm')).toEqual(GENERIC.pm);
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
