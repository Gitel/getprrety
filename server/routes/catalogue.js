// Catalogue data for the customer app (the "My products" screen and the Home step thumbnails).
//   GET /api/catalogue/products?ids=...   -> product cards (needs a logged-in user)
//   GET /api/catalogue/products/:id/photo -> the photo bytes (PUBLIC, see below)
// The admin side of the catalogue lives in routes/admin.js; nothing is shared with it.
const router = require('express').Router();
const CatalogueProduct = require('../models/CatalogueProduct');
const requireAuth = require('../middleware/auth');
const { getProductPhoto } = require('../services/catalogueProducts');

const MAX_IDS = 20;
const HEX_ID = /^[a-f0-9]{24}$/i;

// Parse "?ids=a,b,c" into a de-duplicated list (first occurrence wins, so the order of the
// request is kept). Returns null when it is not 1-20 valid 24-hex ids.
function parseIds(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const ids = [...new Set(raw.split(',').map(id => id.trim().toLowerCase()))];
  if (ids.length > MAX_IDS || !ids.every(id => HEX_ID.test(id))) return null;
  return ids;
}

// Only the fields the app needs. Ingredients, strengths, suitableFor, pregnancy, use,
// seedKey and the photo bytes are never selected (photo.size is only used to tell whether
// a photo exists).
router.get('/products', requireAuth, async (req, res, next) => {
  try {
    const ids = parseIds(req.query.ids);
    if (!ids) return res.status(400).json({ error: 'INVALID_IDS' });

    const docs = await CatalogueProduct.find({ _id: { $in: ids } })
      .select('name category keyActives price shopUrl archived updatedAt photo.size')
      .lean();
    const byId = new Map(docs.map(doc => [String(doc._id), doc]));

    // Answer in the order of the request; ids that do not exist are simply left out.
    // Archived products ARE returned (flagged) so an old analysis can still show them.
    const products = ids.filter(id => byId.has(id)).map(id => {
      const doc = byId.get(id);
      return {
        id,
        name: doc.name,
        category: doc.category || null,
        keyActives: doc.keyActives || [],
        price: typeof doc.price === 'number' ? doc.price : null,
        shopUrl: doc.shopUrl || null,
        hasPhoto: Boolean(doc.photo && doc.photo.size),
        // Changes whenever the product is saved; the app puts it in the photo URL (?v=) so a
        // replaced photo is fetched again while an unchanged one stays cached for a year.
        photoVersion: new Date(doc.updatedAt).getTime(),
        archived: Boolean(doc.archived),
      };
    });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

// True when the browser's If-None-Match header lists our ETag (weak "W/" prefix ignored).
function etagMatches(header, etag) {
  if (!header) return false;
  return header.split(',').some(tag => tag.trim().replace(/^W\//, '') === etag);
}

// PUBLIC on purpose: the app shows these in <img> tags, which cannot send a Bearer token.
// The photos are product marketing images, not user data. Archived products are served too.
router.get('/products/:id/photo', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!HEX_ID.test(id)) return res.status(404).send('Not found');

    // Cheap metadata query first (no bytes), so a 304 never loads the photo from the database.
    const meta = await CatalogueProduct.findById(id).select('updatedAt photo.size').lean();
    if (!meta || !meta.photo || !meta.photo.size) return res.status(404).send('Not found');

    const etag = `"${id}-${new Date(meta.updatedAt).getTime()}"`;
    res.set('ETag', etag);
    // With ?v=<photoVersion> the URL changes whenever the photo does, so it can be cached for
    // a year. Without it we cannot know, so keep it short.
    res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    // helmet() sends Cross-Origin-Resource-Policy: same-origin on every response, which would
    // make browsers block these images when the web/native app (another origin) shows them.
    // Relaxed for this public photo route only.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');

    if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();

    const photo = await getProductPhoto(id);
    if (!photo) return res.status(404).send('Not found');
    res.set('Content-Type', photo.mimeType || 'image/jpeg');
    res.send(photo.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
