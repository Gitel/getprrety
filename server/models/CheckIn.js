const mongoose = require('mongoose');

const checkInSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mood:   { type: String, required: true },
  date:   { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('CheckIn', checkInSchema);
