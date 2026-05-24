const mongoose = require('mongoose');

const uploadSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  data:     { type: Buffer, required: true },
  mimeType: { type: String, default: 'image/jpeg' },
  size:     { type: Number },
}, { timestamps: true });

module.exports = mongoose.model('Upload', uploadSchema);
