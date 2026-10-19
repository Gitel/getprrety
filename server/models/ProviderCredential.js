const mongoose = require('mongoose');

// A provider is the document ID, so MongoDB's built-in unique _id index prevents duplicates.
// The encrypted value and fingerprint must be explicitly selected by the credential service.
const schema = new mongoose.Schema({
  _id: { type: String, enum: ['perfectcorp', 'anthropic'] },
  encrypted: { type: String, select: false },
  fingerprint: { type: String, select: false },
  updatedBy: String,
  replacedAt: Date,
  health: { type: String, enum: ['verified', 'expired', 'rejected', 'unavailable'], default: undefined },
  checkedAt: Date,
}, { timestamps: true, bufferCommands: false });

module.exports = mongoose.model('ProviderCredential', schema);
