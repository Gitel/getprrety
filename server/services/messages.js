// In-app messaging between the clinic and users. All reads/writes go through here, used
// by routes/messages.js (the app) and routes/admin.js (the dashboard).
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const { consumeRateLimit } = require('./rateLimit');

const MAX_BODY = Message.MAX_BODY;
const USER_REPLIES_PER_HOUR = 20;
const APP_THREAD_LIMIT = 100;   // messages the app loads
const ADMIN_THREAD_LIMIT = 200; // messages the dashboard shows

/**
 * Validate a message body. Too-long text is rejected, not truncated: silently cutting
 * someone's message would change what they said.
 * @returns {{ body: string } | { error: 'empty' | 'too_long' }}
 */
function cleanBody(raw) {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body) return { error: 'empty' };
  if (body.length > MAX_BODY) return { error: 'too_long' };
  return { body };
}

// Shape sent to the app: no adminEmail (the app shows "Your clinic"), `id` not `_id`.
function toAppMessage(m) {
  return { id: String(m._id), from: m.from, body: m.body, createdAt: m.createdAt, readAt: m.readAt || null };
}

// ── App side (the signed-in user) ───────────────────────────────────────────

// The user's thread, oldest first (chat order), last APP_THREAD_LIMIT messages.
async function threadForUser(userId, { model = Message } = {}) {
  const newestFirst = await model.find({ userId })
    .select('from body readAt createdAt')
    .sort({ createdAt: -1 })
    .limit(APP_THREAD_LIMIT)
    .lean();
  return newestFirst.reverse().map(toAppMessage);
}

// Clinic messages the user has not opened yet (the app's badge).
function unreadForUser(userId, { model = Message } = {}) {
  return model.countDocuments({ userId, from: 'admin', readAt: null });
}

// The user opened the thread: mark every clinic message as read.
async function markReadByUser(userId, { model = Message, now = new Date() } = {}) {
  await model.updateMany({ userId, from: 'admin', readAt: null }, { $set: { readAt: now } });
}

/**
 * A user's reply. The app's JWT is only checked for signature and expiry, so a deleted
 * account's token still authenticates; checking the user exists stops it from creating
 * orphan messages.
 * @returns {{ ok: true, message } | { ok: false, code: 'empty'|'too_long'|'user_gone'|'rate_limited' }}
 */
async function postUserReply(userId, rawBody, deps = {}) {
  const { model = Message, userModel = User, rateLimit = consumeRateLimit } = deps;
  const cleaned = cleanBody(rawBody);
  if (cleaned.error) return { ok: false, code: cleaned.error };
  if (!(await userModel.exists({ _id: userId }))) return { ok: false, code: 'user_gone' };
  if (!(await rateLimit('msg_user', String(userId), USER_REPLIES_PER_HOUR))) return { ok: false, code: 'rate_limited' };
  const doc = await model.create({ userId, from: 'user', body: cleaned.body });
  return { ok: true, message: toAppMessage(doc) };
}

// ── Admin side (the dashboard) ──────────────────────────────────────────────

/**
 * The clinic writes to a user.
 * @returns {{ ok: true } | { ok: false, code: 'empty'|'too_long'|'user_gone' }}
 */
async function sendAdminMessage({ userId, adminEmail, body: rawBody }, deps = {}) {
  const { model = Message, userModel = User } = deps;
  const cleaned = cleanBody(rawBody);
  if (cleaned.error) return { ok: false, code: cleaned.error };
  if (!mongoose.isValidObjectId(userId) || !(await userModel.exists({ _id: userId }))) {
    return { ok: false, code: 'user_gone' };
  }
  await model.create({ userId, from: 'admin', adminEmail, body: cleaned.body });
  return { ok: true };
}

// Full thread for the dashboard (includes which admin wrote each message), oldest first.
async function threadForAdmin(userId, { model = Message } = {}) {
  const newestFirst = await model.find({ userId }).sort({ createdAt: -1 }).limit(ADMIN_THREAD_LIMIT).lean();
  return newestFirst.reverse();
}

// An admin opened the thread: the user's replies count as read for every admin.
async function markReadByAdmin(userId, { model = Message, now = new Date() } = {}) {
  await model.updateMany({ userId, from: 'user', readAt: null }, { $set: { readAt: now } });
}

// Unread user replies across all users (the dashboard nav badge).
function unreadRepliesCount({ model = Message } = {}) {
  return model.countDocuments({ from: 'user', readAt: null });
}

/**
 * The Inbox: users with unread replies, most recent reply first, with the user's name and
 * email attached. One aggregate plus one user lookup, not one query per row.
 */
async function inbox({ model = Message, userModel = User } = {}) {
  const groups = await model.aggregate([
    { $match: { from: 'user', readAt: null } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$userId', unread: { $sum: 1 }, latestAt: { $first: '$createdAt' }, latestBody: { $first: '$body' } } },
    { $sort: { latestAt: -1 } },
    { $limit: 200 },
  ]);
  const users = groups.length
    ? await userModel.find({ _id: { $in: groups.map(g => g._id) } }).select('firstName email').lean()
    : [];
  const byId = new Map(users.map(u => [String(u._id), u]));
  return groups.map(g => ({ ...g, userId: g._id, user: byId.get(String(g._id)) || null }));
}

module.exports = {
  MAX_BODY,
  USER_REPLIES_PER_HOUR,
  cleanBody,
  toAppMessage,
  threadForUser,
  unreadForUser,
  markReadByUser,
  postUserReply,
  sendAdminMessage,
  threadForAdmin,
  markReadByAdmin,
  unreadRepliesCount,
  inbox,
};
