const fs = require('node:fs');
const path = require('node:path');
const CatalogueProduct = require('../../models/CatalogueProduct');

const DEFAULT_CATALOGUE_PATH = path.resolve(__dirname, '../../data/catalogue-seed/products.json');
const CATALOGUE_QUERY_MAX_TIME_MS = 5_000;
const MODEL_FIELDS = [
  '_id', 'name', 'category', 'use', 'pregnancy', 'archived',
  'keyActives', 'strengths', 'suitableFor', 'ingredients',
].join(' ');

// Normalize only the fields the recommendation contract consumes; photo bytes never enter model context.
function normalizeProduct(product) {
  return {
    _id: String(product._id),
    name: product.name,
    category: product.category,
    use: product.use,
    pregnancy: product.pregnancy || 'not_stated',
    archived: Boolean(product.archived),
    keyActives: Array.isArray(product.keyActives) ? product.keyActives : [],
    strengths: Array.isArray(product.strengths) ? product.strengths : [],
    suitableFor: Array.isArray(product.suitableFor) ? product.suitableFor : [],
    ingredients: typeof product.ingredients === 'string' ? product.ingredients : '',
  };
}

// Read active home-use records from the app's already-connected model. Errors propagate so a DB
// outage cannot silently switch recommendations to an older checked-in catalogue.
async function loadCatalogue({ model = CatalogueProduct } = {}) {
  const products = await model.find(
    { use: 'home', archived: { $ne: true } },
    MODEL_FIELDS
  ).lean().maxTimeMS(CATALOGUE_QUERY_MAX_TIME_MS);
  return products.map(normalizeProduct);
}

// Offline evaluators use the committed seed explicitly; this never represents live admin edits.
function loadSeedCatalogue(filePath = DEFAULT_CATALOGUE_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed?.products)) throw new Error('Repository catalogue is invalid');
  return parsed.products
    .filter(product => product && product.use === 'home' && typeof product.seedKey === 'string' && product.seedKey)
    .map(product => normalizeProduct({ ...product, _id: product.seedKey, archived: false }));
}

// Evaluators can opt into a reviewed database snapshot without connecting to MongoDB.
function loadSnapshotCatalogue(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed?.products)) throw new Error('Catalogue snapshot is invalid');
  return parsed.products
    .filter(product => product && product.use === 'home' && product.archived !== true
      && typeof product._id === 'string' && product._id)
    .map(normalizeProduct);
}

module.exports = {
  DEFAULT_CATALOGUE_PATH,
  CATALOGUE_QUERY_MAX_TIME_MS,
  MODEL_FIELDS,
  loadCatalogue,
  loadSeedCatalogue,
  loadSnapshotCatalogue,
};
