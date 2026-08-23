const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName:      { type: String, trim: true },
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:   { type: String, required: function () { return !this.googleId; } },
  googleId:       { type: String, unique: true, sparse: true, default: null },
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

module.exports = mongoose.model('User', userSchema);
