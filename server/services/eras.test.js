const fs = require('fs');
const path = require('path');
const { ERAS, eraById } = require('./eras');

// Reads the ERAS object literal out of the app's src/constants.js (an ES module the server
// cannot require) and evaluates just that literal. It is plain data in our own repo, so
// evaluating it is safe; this is what lets the test catch any drift between the copies.
function clientEras() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'constants.js'), 'utf8');
  const match = source.match(/export const ERAS = (\{[\s\S]*?\n\});/);
  if (!match) throw new Error('Could not find `export const ERAS = {...};` in src/constants.js');
  return new Function(`return (${match[1]});`)();
}

test('the server copy matches the app table exactly', () => {
  expect(ERAS).toEqual(clientEras());
});

test('eraById returns a complete copy for a known id', () => {
  const era = eraById('glow_building');
  expect(era).toEqual(ERAS.glow_building);
  era.name = 'mutated';
  expect(ERAS.glow_building.name).toBe('Glow Building Era'); // the table itself is untouched
});

test.each(['nope', '', undefined, 'constructor', '__proto__', 42])('eraById(%p) is null', id => {
  expect(eraById(id)).toBeNull();
});
