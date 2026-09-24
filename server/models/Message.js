const mongoose = require('mongoose');

// Two-way in-app messages between the clinic (any admin) and one user. There is one
// thread per user: every message belongs to exactly one userId. Delivery is in-app only
// (the app polls / refreshes); WhatsApp is planned separately.
const messageSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Who wrote it: the clinic ('admin') or the user ('user').
  from:       { type: String, enum: ['admin', 'user'], required: true },
  // Which admin wrote an admin message. Shown on the dashboard, NEVER sent to the app,
  // where the sender is always shown as "Your clinic".
  adminEmail: { type: String, lowercase: true, trim: true, default: null },
  body:       { type: String, required: true, trim: true, maxlength: 2000 },
  // When the RECIPIENT read it: the user for admin messages, any admin for user replies.
  // null = unread. Drives the unread badges on both sides.
  readAt:     { type: Date, default: null },
}, { timestamps: true });

// A user's thread, newest first.
messageSchema.index({ userId: 1, createdAt: -1 });
// The admin Inbox and badge: unread user replies across all users.
messageSchema.index({ from: 1, readAt: 1, createdAt: -1 });

const Message = mongoose.model('Message', messageSchema);
Message.MAX_BODY = 2000;

module.exports = Message;
