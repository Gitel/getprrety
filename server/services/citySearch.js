function normalizeCityQuery(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .slice(0, 100);
}

function rawCityQuery(value) {
  return String(value || '').trim().slice(0, 100);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCityPrefixRegex(value) {
  const query = normalizeCityQuery(value);
  if (query.length < 2) return null;
  return new RegExp(`^${escapeRegex(query)}`, 'i');
}

function buildCityPrefixFilter(value) {
  const raw = rawCityQuery(value);
  const normalized = normalizeCityQuery(raw);
  if (normalized.length < 2) return null;

  const filters = [{ name: new RegExp(`^${escapeRegex(normalized)}`, 'i') }];
  if (raw !== normalized) {
    filters.push({ displayName: new RegExp(`^${escapeRegex(raw)}`, 'i') });
  }
  return filters.length === 1 ? filters[0] : { $or: filters };
}

function toCityResult(city) {
  return {
    city: city.displayName,
    country: city.country,
    lat: city.lat,
    lng: city.lng,
    timezone: city.timezone,
  };
}

module.exports = {
  buildCityPrefixFilter,
  buildCityPrefixRegex,
  escapeRegex,
  normalizeCityQuery,
  toCityResult,
};
