const mongoose = require('mongoose');

// A one-time sign-in link an admin creates for a user ('signin') or to invite a new
// person ('invite'). Only a hash of the raw token is used for lookup; an encrypted copy
// is kept so the admin page can show the link again (see services/loginLinks.js).
const loginLinkSchema = new mongoose.Schema({
  purpose:   { type: String, enum: ['signin', 'invite'], required: true },
  // Hex SHA-256 of the raw token. The redeem route looks the link up by this.
  tokenHash: { type: String, required: true, unique: true },
  // AES-256-GCM of the raw token: base64(iv(12) | tag(16) | ciphertext).
  tokenEnc:  { type: String, required: true },
  // Signin links: the user. Invite links: filled in once the invite is redeemed.
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Present only for purpose 'invite': who is being invited.
  invite: {
    type: {
      email:     { type: String, lowercase: true, trim: true },
      firstName: { type: String, trim: true },
      language:  { type: String, enum: ['en', 'he'] },
    },
    _id: false,
  },
  createdByAdminEmail: { type: String },
  expiresAt: { type: Date, required: true },
  usedAt:    { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  lastSentAt: { type: Date, default: null },
  sendCount: { type: Number, default: 0 },
  // Short reason only, never the raw provider error.
  lastSendError: { type: String, default: null },
}, { timestamps: true });

// "Links of this user", newest first.
loginLinkSchema.index({ userId: 1, createdAt: -1 });
// "Invites for this email", newest first.
loginLinkSchema.index({ 'invite.email': 1, createdAt: -1 });
// Rows are deleted 30 days AFTER they expire, so the admin can still see recent history.
loginLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

const LoginLink = mongoose.model('LoginLink', loginLinkSchema);
LoginLink.LIFETIME_HOURS = 72;

module.exports = LoginLink;
