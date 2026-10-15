// Tests for the catalogue client. api is mocked: no real network.
import { fetchCatalogueProducts, photoUrl, clearCatalogueCache } from './catalogueApi';
import { idsKey } from './useCatalogueProducts';
import { api } from './api';

jest.mock('./api', () => ({ BASE: 'http://api.test', api: { catalogueProducts: jest.fn() } }));

// Builds a 24-hex id from a number so tests can make many distinct ids.
const id = n => String(n).padStart(24, '0');
// Fake server: answers every requested id with a product.
const serve = ids => ({ products: ids.map(i => ({ id: i, name: `P${i}`, hasPhoto: false })) });

beforeEach(() => {
  clearCatalogueCache();
  api.catalogueProducts.mockReset();
  api.catalogueProducts.mockImplementation(async ids => serve(ids));
});

describe('fetchCatalogueProducts', () => {
  test('returns {} without a request when there are no valid ids', async () => {
    expect(await fetchCatalogueProducts([])).toEqual({});
    expect(await fetchCatalogueProducts(undefined)).toEqual({});
    expect(await fetchCatalogueProducts(['sr-clean', 'admin-entered', null, 'A'.repeat(24)])).toEqual({});
    expect(api.catalogueProducts).not.toHaveBeenCalled();
  });

  test('filters invalid ids and de-duplicates the valid ones', async () => {
    const res = await fetchCatalogueProducts([id(1), id(1), 'sr-clean']);
    expect(api.catalogueProducts).toHaveBeenCalledTimes(1);
    expect(api.catalogueProducts).toHaveBeenCalledWith([id(1)]);
    expect(Object.keys(res)).toEqual([id(1)]);
  });

  test('a second call is served from the cache', async () => {
    await fetchCatalogueProducts([id(1), id(2)]);
    const res = await fetchCatalogueProducts([id(2), id(1)]);
    expect(api.catalogueProducts).toHaveBeenCalledTimes(1);
    expect(Object.keys(res).sort()).toEqual([id(1), id(2)]);
  });

  test('a partially cached call requests only the missing ids', async () => {
    await fetchCatalogueProducts([id(1)]);
    const res = await fetchCatalogueProducts([id(1), id(2)]);
    expect(api.catalogueProducts).toHaveBeenLastCalledWith([id(2)]);
    expect(Object.keys(res).sort()).toEqual([id(1), id(2)]);
  });

  test('splits more than 20 ids into chunks of at most 20', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => id(i + 1));
    const res = await fetchCatalogueProducts(ids);
    expect(api.catalogueProducts.mock.calls.map(c => c[0].length)).toEqual([20, 20, 5]);
    expect(Object.keys(res)).toHaveLength(45);
  });

  test('on error it never throws and returns what the cache has', async () => {
    await fetchCatalogueProducts([id(1)]);
    api.catalogueProducts.mockRejectedValue(new Error('offline'));
    const res = await fetchCatalogueProducts([id(1), id(2)]);
    expect(Object.keys(res)).toEqual([id(1)]);
  });

  test('clearCatalogueCache forces a new request', async () => {
    await fetchCatalogueProducts([id(1)]);
    clearCatalogueCache();
    await fetchCatalogueProducts([id(1)]);
    expect(api.catalogueProducts).toHaveBeenCalledTimes(2);
  });
});

describe('photoUrl', () => {
  test('builds the versioned public photo URL', () => {
    expect(photoUrl({ id: id(7), hasPhoto: true, photoVersion: 1234 }))
      .toBe(`http://api.test/api/catalogue/products/${id(7)}/photo?v=1234`);
  });
  test('is null without a photo or product', () => {
    expect(photoUrl({ id: id(7), hasPhoto: false, photoVersion: 1 })).toBeNull();
    expect(photoUrl(null)).toBeNull();
  });
});

// The hook itself needs a React renderer (the repo has none, tests run in node);
// its re-fetch trigger is this pure key.
describe('idsKey', () => {
  test('is order- and duplicate-insensitive, empty for no ids', () => {
    expect(idsKey(['b', 'a', 'b'])).toBe(idsKey(['a', 'b']));
    expect(idsKey(['a', 'b'])).not.toBe(idsKey(['a', 'c']));
    expect(idsKey(undefined)).toBe('');
  });
});
