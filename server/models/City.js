const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
  name:        { type: String, required: true },
  displayName: { type: String, required: true },
  country:     { type: String, required: true, uppercase: true, minlength: 2, maxlength: 2 },
  lat:         { type: Number, required: true },
  lng:         { type: Number, required: true },
  timezone:    { type: String, required: true },
  population:  { type: Number, required: true, min: 0 },
}, {
  versionKey: false,
  autoIndex: false,
});

citySchema.index({ name: 'text', displayName: 'text' });
citySchema.index({ name: 1 });
citySchema.index({ displayName: 1 });
citySchema.index({ country: 1, population: -1 });

module.exports = mongoose.model('City', citySchema);
