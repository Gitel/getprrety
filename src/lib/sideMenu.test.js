import { menuAction } from './sideMenu';

// The screens that can show or be reached from the side menu.
const SCREENS = ['Home', 'Profile', 'Messages', 'Settings', 'ProductCamera'];
const OTHERS = SCREENS.filter(s => s !== 'Home');

test.each(SCREENS)('tapping the current screen (%s) closes the menu', screen => {
  expect(menuAction(screen, screen)).toBe('close');
});

test.each(OTHERS)('%s -> Home goes back', current => {
  expect(menuAction(current, 'Home')).toBe('back');
});

test.each(OTHERS)('Home -> %s navigates (push)', target => {
  expect(menuAction('Home', target)).toBe('navigate');
});

const HOPS = OTHERS.flatMap(from => OTHERS.filter(to => to !== from).map(to => [from, to]));
test.each(HOPS)('%s -> %s replaces the top screen', (from, to) => {
  expect(menuAction(from, to)).toBe('replace');
});

test('every ordered pair of menu screens is covered', () => {
  // 5 same-screen + 4 to-Home + 4 from-Home + 12 hops = all 25 pairs.
  const all = SCREENS.flatMap(a => SCREENS.map(b => menuAction(a, b)));
  expect(all).toHaveLength(25);
  expect(all.filter(x => x === 'close')).toHaveLength(5);
  expect(all.filter(x => x === 'back')).toHaveLength(4);
  expect(all.filter(x => x === 'navigate')).toHaveLength(4);
  expect(all.filter(x => x === 'replace')).toHaveLength(12);
});
