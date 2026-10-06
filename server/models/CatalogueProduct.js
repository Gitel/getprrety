const mongoose = require('mongoose');

// Allowed values, exported on the model so the admin form, the service validation and the
// tests all read ONE list. The order of CATEGORIES is also the display order of the catalogue.
const CATEGORIES = ['cleansers_peelings', 'face_serums', 'eye', 'face_creams', 'masks'];
const USES = ['home', 'guided', 'professional'];
const PREGNANCY = ['safe', 'avoid', 'not_stated'];

// One product of the SR catalogue, managed from /admin/catalogue.
// - slug is the stable identifier (set once at creation, never changes, even on rename).
// - nameKey is the lower-cased name; its unique index makes names unique ignoring case.
// - the photo bytes live inside the document (like the Upload model) so no file storage is
//   needed. List queries must exclude them with .select('-photo.data').
// - archived hides a product instead of deleting it.
const catalogueProductSchema = new mongoose.Schema({
  slug:      { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  name:      { type: String, required: true, trim: true, maxlength: 120 },
  nameKey:   { type: String, required: true, unique: true },
  category:  { type: String, enum: CATEGORIES },
  use:       { type: String, enum: USES },
  pregnancy: { type: String, enum: PREGNANCY },
  keyActives:  { type: [String], default: [] },
  strengths:   { type: [String], default: [] },
  suitableFor: { type: [String], default: [] },
  ingredients: { type: String, default: '' },
  photo: {
    data:     Buffer,
    mimeType: String,
    size:     Number,
  },
  archived: { type: Boolean, default: false },
}, { timestamps: true });

// Keep nameKey in sync with name for create() / save() / insertMany().
// NOTE: this hook does NOT run for findByIdAndUpdate + $set (query updates bypass document
// hooks), so services/catalogueProducts.js sets nameKey explicitly when it renames a product.
catalogueProductSchema.pre('validate', function setNameKey(next) {
  if (typeof this.name === 'string' && this.name.trim()) this.nameKey = this.name.trim().toLowerCase();
  next();
});

const CatalogueProduct = mongoose.model('CatalogueProduct', catalogueProductSchema);
CatalogueProduct.CATEGORIES = CATEGORIES;
CatalogueProduct.USES = USES;
CatalogueProduct.PREGNANCY = PREGNANCY;

module.exports = CatalogueProduct;
