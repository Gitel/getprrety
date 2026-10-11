const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CATALOGUE_PATH = path.resolve(__dirname, '../../data/catalogue-seed/products.json');

// Bedrock uses the checked-in catalogue directly; seedKey is its permanent repository ID,
// not a MongoDB ObjectId. Photo paths are intentionally omitted from model context.
function loadCatalogue(filePath = DEFAULT_CATALOGUE_PATH) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed?.products)) throw new Error('Repository catalogue is invalid');
  return parsed.products
    .filter(product => product && product.use === 'home' && typeof product.seedKey === 'string' && product.seedKey)
    .map(product => ({
      _id: product.seedKey,
      name: product.name,
      category: product.category,
      use: product.use,
      pregnancy: product.pregnancy || 'not_stated',
      archived: false,
      keyActives: Array.isArray(product.keyActives) ? product.keyActives : [],
      strengths: Array.isArray(product.strengths) ? product.strengths : [],
      suitableFor: Array.isArray(product.suitableFor) ? product.suitableFor : [],
      ingredients: typeof product.ingredients === 'string' ? product.ingredients : '',
    }));
}

module.exports = { DEFAULT_CATALOGUE_PATH, loadCatalogue };
