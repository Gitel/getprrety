import {
  EDGE_PX,
  canSwipeBack,
  startsAtEdge,
  backDistance,
  shouldGoBack,
} from './swipeBack';

const s = (...names) => names.map(name => ({ name, params: {} }));

describe('canSwipeBack', () => {
  test('empty stack is false', () => expect(canSwipeBack([])).toBe(false));
  test('one screen is false', () => expect(canSwipeBack(s('Home'))).toBe(false));
  test('does not throw on missing names', () => {
    expect(canSwipeBack([{}, {}])).toBe(true);
    expect(canSwipeBack(undefined)).toBe(false);
  });

  test.each([
    [['Home', 'Messages']],
    [['Home', 'Settings']],
    [['Home', 'Profile']],
    [['Login', 'SignUp']],
    [['Login', 'Notifications', 'Home']],
    [['Loading', 'Profile', 'Home']],
  ])('%j is true', names => expect(canSwipeBack(s(...names))).toBe(true));

  test.each([
    [['Home', 'Loading']],
    [['Home', 'Quiz']],
    [['Quiz', 'Loading', 'Profile']],
  ])('%j is false', names => expect(canSwipeBack(s(...names))).toBe(false));
});

describe('startsAtEdge', () => {
  const W = 400;
  test.each([
    [0, true],
    [24, true],
    [25, false],
    [W - 24, false],
    [W, false],
  ])('ltr x=%i -> %s', (x, expected) => expect(startsAtEdge(x, W, false)).toBe(expected));

  test.each([
    [W, true],
    [W - 24, true],
    [W - 25, false],
    [24, false],
    [0, false],
  ])('rtl x=%i -> %s', (x, expected) => expect(startsAtEdge(x, W, true)).toBe(expected));

  test('EDGE_PX is 24', () => expect(EDGE_PX).toBe(24));
});

describe('backDistance', () => {
  test('ltr: moving right is positive', () => {
    expect(backDistance(50, false)).toBe(50);
    expect(backDistance(-50, false)).toBe(-50);
  });
  test('rtl: moving left is positive', () => {
    expect(backDistance(-50, true)).toBe(50);
    expect(backDistance(50, true)).toBe(-50);
  });
});

describe('shouldGoBack', () => {
  const width = 400; // 35% = 140
  test('exactly 35% is false', () => expect(shouldGoBack({ distance: 140, width, velocity: 0 })).toBe(false));
  test('just above 35% is true', () => expect(shouldGoBack({ distance: 141, width, velocity: 0 })).toBe(true));
  test('fast but short (<= 40 px) is false', () => {
    expect(shouldGoBack({ distance: 40, width, velocity: 2 })).toBe(false);
    expect(shouldGoBack({ distance: 10, width, velocity: 2 })).toBe(false);
  });
  test('fast and > 40 px is true', () => expect(shouldGoBack({ distance: 41, width, velocity: 0.6 })).toBe(true));
  test('slow and long is true', () => expect(shouldGoBack({ distance: 200, width, velocity: 0.1 })).toBe(true));
  test('slow and short is false', () => expect(shouldGoBack({ distance: 60, width, velocity: 0.1 })).toBe(false));
});
