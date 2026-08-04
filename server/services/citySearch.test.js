const {
  buildCityPrefixFilter,
  buildCityPrefixRegex,
  escapeRegex,
  normalizeCityQuery,
  toCityResult,
} = require('./citySearch');

describe('city search helpers', () => {
  test('normalizes accented input for matching the GeoNames ASCII name', () => {
    expect(normalizeCityQuery('  São Paulo ')).toBe('Sao Paulo');
    expect(buildCityPrefixRegex('Beér').test('Beer Sheva')).toBe(true);
  });

  test('also searches the display name when GeoNames transliteration differs', () => {
    const filter = buildCityPrefixFilter('Zürich');
    expect(filter.$or[0].name.test('Zuerich')).toBe(false);
    expect(filter.$or[1].displayName.test('Zürich')).toBe(true);
  });

  test('escapes regex metacharacters and keeps matching prefix-only', () => {
    expect(escapeRegex('St. John (N)')).toBe('St\\. John \\(N\\)');
    const regex = buildCityPrefixRegex('St.');
    expect(regex.test('St. Louis')).toBe(true);
    expect(regex.test('Stx Louis')).toBe(false);
    expect(regex.test('East St. Louis')).toBe(false);
  });

  test('does not search for fewer than two characters', () => {
    expect(buildCityPrefixRegex('')).toBeNull();
    expect(buildCityPrefixRegex(' A ')).toBeNull();
  });

  test('maps database fields to the public response contract', () => {
    expect(toCityResult({
      displayName: 'São Paulo', country: 'BR', lat: -23.55, lng: -46.63,
      timezone: 'America/Sao_Paulo', population: 100,
    })).toEqual({
      city: 'São Paulo', country: 'BR', lat: -23.55, lng: -46.63,
      timezone: 'America/Sao_Paulo',
    });
  });
});
