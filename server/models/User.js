const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName:      { type: String, trim: true },
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:   { type: String, required: function () { return !this.googleId; } },
  // No default: an email signup must leave this field absent entirely. It previously
  // defaulted to null, and see the index below for why that broke every signup.
  googleId:       { type: String },
  skinEra:        { type: String, default: null },
  skincareTiming:  { type: String, enum: ['morning', 'night', 'both', null], default: null },
  selfiePhotoIds:  { type: [String], default: [] },
  shelfPhotoIds:   { type: [String], default: [] },
  termsAcceptedAt: { type: Date, default: null },
  privacyAcceptedAt: { type: Date, default: null },
  consentVersion: { type: String, default: null },
  city:           { type: String, trim: true, default: null },
  country:        { type: String, uppercase: true, trim: true, default: null },
  lat:            { type: Number, default: null },
  lng:            { type: Number, default: null },
  timezone:       { type: String, trim: true, default: null },
}, { timestamps: true });

// Unique across accounts that actually have a Google id, and no others. This cannot be a
// sparse index: sparse only skips documents that LACK the field, and googleId used to
// default to null, so every email signup stored a present-but-null value that got indexed.
// The second email-only account then collided on googleId_1, and the signup route reported
// that E11000 as "Email already registered" — for an address nobody had ever used. In
// effect the database could hold exactly one email+password account.
// A partial filter keyed on the type excludes both null and absent values, so it also
// covers any legacy rows still carrying an explicit null.
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);

module.exports = mongoose.model('User', userSchema);
