// Client for the catalogue product endpoints (server/routes/catalogue.js).
// Products are looked up by id and kept in an in-memory cache for the session, so
// showing the same product on several screens costs one request.
import { api, BASE } from './api';

const HEX_ID = /^[a-f0-9]{24}$/;
const CHUNK_SIZE = 20; // the server accepts at most 20 ids per request

// id -> product. Lives only in memory: gone on reload and cleared on logout.
let cache = {};

export function clearCatalogueCache() {
  cache = {};
}

// ids -> Promise<{ [id]: product }>. Never throws: on any error it returns what the cache has.
export async function fetchCatalogueProducts(ids) {
  // Keep only valid, unique ids (old analyses contain ids like 'sr-clean').
  const valid = [...new Set((ids || []).filter(id => typeof id === 'string' && HEX_ID.test(id)))];
  if (valid.length === 0) return {};

  // Only ask the server for ids we do not already have, in chunks of CHUNK_SIZE.
  const missing = valid.filter(id => !cache[id]);
  try {
    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      const res = await api.catalogueProducts(missing.slice(i, i + CHUNK_SIZE));
      (res?.products || []).forEach(product => { cache[product.id] = product; });
    }
  } catch {
    // Offline / server error: fall through and return whatever we already have.
  }

  const result = {};
  valid.forEach(id => { if (cache[id]) result[id] = cache[id]; });
  return result;
}

// Public photo URL for <img> tags, or null when the product has no photo.
// ?v= changes when the photo changes, so a replaced photo is not served from browser cache.
export function photoUrl(p) {
  if (!p || !p.hasPhoto) return null;
  return `${BASE}/api/catalogue/products/${p.id}/photo?v=${p.photoVersion}`;
}
