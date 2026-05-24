const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName:      { type: String, required: true, trim: true },
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:   { type: String, required: true },
  skinEra:        { type: String, default: null },
  skincareTiming:  { type: String, enum: ['morning', 'night', 'both', null], default: null },
  selfiePhotoIds:  { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
