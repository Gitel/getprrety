const { locationFromQuizAnswers } = require('../routes/analysis');

describe('profile location persistence', () => {
  test('keeps a selected GeoNames result', () => {
    expect(locationFromQuizAnswers({
      city: 'Tel Aviv', country: 'il', lat: 32.0853, lng: 34.7818,
      timezone: 'Asia/Jerusalem',
    })).toEqual({
      city: 'Tel Aviv', country: 'IL', lat: 32.0853, lng: 34.7818,
      timezone: 'Asia/Jerusalem',
    });
  });

  test('keeps a raw city while clearing unavailable metadata', () => {
    expect(locationFromQuizAnswers({ city: 'My small town' })).toEqual({
      city: 'My small town', country: null, lat: null, lng: null, timezone: null,
    });
  });

  test('rejects invalid coordinate and country metadata', () => {
    expect(locationFromQuizAnswers({
      city: 'Somewhere', country: 'USA', lat: 91, lng: Infinity, timezone: '',
    })).toEqual({ city: 'Somewhere', country: null, lat: null, lng: null, timezone: null });
  });
});
