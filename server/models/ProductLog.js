const mongoose = require('mongoose');

const productLogSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  photoUri:    { type: String },
  productName: { type: String },
  category:    { type: String },
  notes:       { type: String },
}, { timestamps: true });

module.exports = mongoose.model('ProductLog', productLogSchema);
