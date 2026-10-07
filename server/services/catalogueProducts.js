// Admin CRUD for the SR catalogue (CatalogueProduct). Same shape as adminEdits.js: pure
// functions, the model injected as the last argument, one $set with only the changed
// fields, and results of { ok: true, ... } or { ok: false, code } so the route can map the
// code to a notice banner and audit the changed field NAMES.
const mongoose = require('mongoose');
const CatalogueProduct = require('../models/CatalogueProduct');
const { text } = require('./analysisFields');
const { detectImageType } = require('./imageType');

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
// multer limits of the photo upload route (used by routes/admin.js, pinned by a unit test):
// one file of at most 2 MB plus a few small text fields (the _csrf token).
const PHOTO_UPLOAD_LIMITS = { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 5, parts: 6 };
const MAX_LIST_ITEMS = 60;
const MAX_ITEM_CHARS = 300;

// Human labels for the admin views. Object key order is the display order of categories.
const CATEGORY_LABELS = {
  cleansers_peelings: 'Cleansers & Peelings',
  face_serums: 'Face serums',
  eye: 'Eye',
  face_creams: 'Face creams',
  masks: 'Masks',
};
const USE_LABELS = { home: 'Home use', guided: 'Home use with guidance', professional: 'Professional only' };
const PREGNANCY_LABELS = { safe: 'Safe in pregnancy', avoid: 'Avoid in pregnancy', not_stated: 'Not stated' };

// Fields edited from the form, in the order they are reported as "changed".
const LIST_FIELDS = ['keyActives', 'strengths', 'suitableFor'];
const FORM_FIELDS = ['name', 'category', 'use', 'pregnancy', ...LIST_FIELDS, 'ingredients'];

/**
 * Turn a product name into its URL-safe identifier: lower-case, every run of characters
 * outside a-z / 0-9 becomes one "-", no leading / trailing "-".
 * "Crystal & Silk Peeling" -> "crystal-silk-peeling". May return '' (e.g. a name of "!!!").
 */
function slugify(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A textarea (one item per line) or an array becomes a clean list: trimmed, empty lines
// dropped, each item capped at 300 chars, at most 60 items. Never throws.
function lines(value) {
  let items = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') items = value.split(/\r\n|\n/);
  return items
    .map(item => text(item, MAX_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

// Return the value only when it is one of the allowed ones, else '' (meaning "not valid").
function oneOf(value, allowed) {
  const v = text(value, 50);
  return allowed.includes(v) ? v : '';
}

/**
 * Validate the admin form. Returns { product } (clean values for FORM_FIELDS only; unknown
 * keys such as _csrf are ignored) or { error: 'catalogue_invalid' }.
 */
function parseProductForm(body) {
  const src = body && typeof body === 'object' ? body : {};

  const name = text(src.name, 120);
  const category = oneOf(src.category, CatalogueProduct.CATEGORIES);
  const use = oneOf(src.use, CatalogueProduct.USES);
  const pregnancy = oneOf(src.pregnancy, CatalogueProduct.PREGNANCY);
  if (!name || !category || !use || !pregnancy) return { error: 'catalogue_invalid' };

  return {
    product: {
      name,
      category,
      use,
      pregnancy,
      keyActives: lines(src.keyActives),
      strengths: lines(src.strengths),
      suitableFor: lines(src.suitableFor),
      ingredients: text(src.ingredients, 5000),
    },
  };
}

// True when a Mongo E11000 came from the slug or nameKey unique index. Identified by
// keyPattern when the driver gives it, else by the index name in the message (the same two
// strategies as duplicateKey.js). Anything else is rethrown by the callers.
function isDuplicateProduct(err) {
  if (err?.code !== 11000) return false;
  if (err.keyPattern) return Boolean(err.keyPattern.slug || err.keyPattern.nameKey);
  return /index:\s*(slug_1|nameKey_1)\b/.test(String(err.message || ''));
}

// Lists are compared element by element (order matters); scalars as strings so null / ''
// / undefined all count as "empty" and an unchanged form does not register as an edit.
function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    return x.length === y.length && x.every((item, i) => item === y[i]);
  }
  return String(a == null ? '' : a) === String(b == null ? '' : b);
}

/**
 * Create a product. The slug comes from the name (and follows it when the product is renamed).
 * Returns { ok: true, id, slug } or { ok: false, code: 'catalogue_invalid' | 'catalogue_name_taken' }.
 */
async function createProduct(body, { productModel = CatalogueProduct } = {}) {
  const parsed = parseProductForm(body);
  if (parsed.error) return { ok: false, code: parsed.error };

  const slug = slugify(parsed.product.name);
  // A name with no a-z / 0-9 characters (e.g. only Hebrew letters) has no usable slug.
  if (!slug) return { ok: false, code: 'catalogue_invalid' };

  try {
    const doc = await productModel.create({
      ...parsed.product,
      slug,
      nameKey: parsed.product.name.toLowerCase(),
    });
    return { ok: true, id: String(doc._id), slug };
  } catch (err) {
    // The unique indexes are the real guard (also against two admins racing).
    if (isDuplicateProduct(err)) return { ok: false, code: 'catalogue_name_taken' };
    throw err;
  }
}

/**
 * Apply the edit form to a product. When the name changes the slug is regenerated from the
 * new name (same rule as on create). seedKey is never touched (parseProductForm drops it).
 * Returns { ok: true, changed: [field names] } or { ok: false, code }.
 */
async function updateProduct(id, body, { productModel = CatalogueProduct } = {}) {
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'not_found' };
  const parsed = parseProductForm(body);
  if (parsed.error) return { ok: false, code: parsed.error };

  const current = await productModel.findById(id).select(FORM_FIELDS.join(' ')).lean();
  if (!current) return { ok: false, code: 'not_found' };

  const changed = FORM_FIELDS.filter(k => !sameValue(current[k], parsed.product[k]));
  if (!changed.length) return { ok: true, changed };

  const $set = Object.fromEntries(changed.map(k => [k, parsed.product[k]]));
  // $set bypasses the model's pre('validate') hook, so keep nameKey in step by hand.
  // It is not reported in `changed`: it is derived from name, not an editable field.
  // The slug follows the name too (also not reported: derived, not an editable field).
  if (changed.includes('name')) {
    const slug = slugify(parsed.product.name);
    if (!slug) return { ok: false, code: 'catalogue_invalid' };
    const nameKey = parsed.product.name.toLowerCase();
    // Another product (different _id) already using this slug or name -> refuse, write nothing.
    // (The unique indexes below still guard against two admins racing.)
    const clash = await productModel.findOne({ _id: { $ne: id }, $or: [{ slug }, { nameKey }] }).select('_id').lean();
    if (clash) return { ok: false, code: 'catalogue_name_taken' };
    $set.slug = slug;
    $set.nameKey = nameKey;
  }

  try {
    await productModel.findByIdAndUpdate(id, { $set }, { runValidators: true });
  } catch (err) {
    if (isDuplicateProduct(err)) return { ok: false, code: 'catalogue_name_taken' };
    throw err;
  }
  return { ok: true, changed };
}

/**
 * Archive (true) or restore (false) a product.
 * Returns { ok: true, changed } (changed is false when it was already in that state, and
 * nothing is written) or { ok: false, code: 'not_found' }.
 */
async function setArchived(id, archived, { productModel = CatalogueProduct } = {}) {
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'not_found' };
  const current = await productModel.findById(id).select('archived').lean();
  if (!current) return { ok: false, code: 'not_found' };

  const target = Boolean(archived);
  if (Boolean(current.archived) === target) return { ok: true, changed: false };
  await productModel.findByIdAndUpdate(id, { $set: { archived: target } });
  return { ok: true, changed: true };
}

/**
 * Replace a product's photo. `file` is multer's { buffer, size }.
 * Returns { ok: true } or { ok: false, code: 'not_found' | 'catalogue_photo_invalid' }.
 * The type is decided from the bytes (never the browser-sent type).
 */
async function replacePhoto(id, file, { productModel = CatalogueProduct } = {}) {
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'not_found' };
  const current = await productModel.findById(id).select('_id').lean();
  if (!current) return { ok: false, code: 'not_found' };

  if (!file || !file.buffer) return { ok: false, code: 'catalogue_photo_invalid' };
  const size = file.size == null ? file.buffer.length : file.size;
  if (size > MAX_PHOTO_BYTES) return { ok: false, code: 'catalogue_photo_invalid' };
  const mimeType = detectImageType(file.buffer);
  if (!mimeType) return { ok: false, code: 'catalogue_photo_invalid' };

  await productModel.findByIdAndUpdate(id, { $set: { photo: { data: file.buffer, mimeType, size } } });
  return { ok: true };
}

/**
 * All products (archived included), WITHOUT photo bytes, ordered by category (the order of
 * CATEGORY_LABELS) then name. Each item gets hasPhoto for the list thumbnail.
 */
async function listProducts({ productModel = CatalogueProduct } = {}) {
  const docs = await productModel.find().select('-photo.data').lean();
  const order = Object.keys(CATEGORY_LABELS);
  const rank = p => {
    const i = order.indexOf(p.category);
    return i === -1 ? order.length : i;
  };
  return docs
    .map(p => ({ ...p, hasPhoto: Boolean(p.photo && p.photo.size) }))
    .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
}

/** One product without photo bytes (+ hasPhoto), or null for an unknown / malformed id. */
async function getProduct(id, { productModel = CatalogueProduct } = {}) {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await productModel.findById(id).select('-photo.data').lean();
  if (!doc) return null;
  return { ...doc, hasPhoto: Boolean(doc.photo && doc.photo.size) };
}

/** The photo bytes for the image route: { data, mimeType } or null when there is none. */
async function getProductPhoto(id, { productModel = CatalogueProduct } = {}) {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await productModel.findById(id).select('photo').lean();
  if (!doc || !doc.photo || !doc.photo.data) return null;
  // With .lean(), Mongo returns stored bytes as a BSON `Binary` object, not a Node Buffer.
  // res.send(Binary) would send it as JSON instead of image bytes (the admin thumbnails
  // stayed blank), so unwrap it to a Buffer here. `.buffer` holds the raw bytes.
  const raw = doc.photo.data;
  const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer);
  return { data, mimeType: doc.photo.mimeType };
}

module.exports = {
  slugify,
  parseProductForm,
  createProduct,
  updateProduct,
  setArchived,
  replacePhoto,
  listProducts,
  getProduct,
  getProductPhoto,
  MAX_PHOTO_BYTES,
  PHOTO_UPLOAD_LIMITS,
  CATEGORY_LABELS,
  USE_LABELS,
  PREGNANCY_LABELS,
};
