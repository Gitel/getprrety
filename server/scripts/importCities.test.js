const { parseCityRow } = require('./importCities');

function row(overrides = {}) {
  const columns = [
    '3448439', 'São Paulo', 'Sao Paulo', '', '-23.5475', '-46.63611', 'P', 'PPLA',
    'BR', '', '27', '', '', '', '12400232', '', '769', 'America/Sao_Paulo', '2025-01-01',
  ];
  Object.entries(overrides).forEach(([index, value]) => { columns[Number(index)] = value; });
  return columns.join('\t');
}

describe('GeoNames city row parser', () => {
  test('maps the required columns', () => {
    expect(parseCityRow(row())).toEqual({
      name: 'Sao Paulo', displayName: 'São Paulo', country: 'BR',
      lat: -23.5475, lng: -46.63611, timezone: 'America/Sao_Paulo', population: 12400232,
    });
  });

  test('skips non-populated features and malformed coordinates', () => {
    expect(parseCityRow(row({ 7: 'ADM1' }))).toBeNull();
    expect(parseCityRow(row({ 4: 'not-a-number' }))).toBeNull();
  });
});
