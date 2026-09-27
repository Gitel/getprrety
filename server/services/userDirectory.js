const mongoose = require('mongoose');
const User = require('../models/User');
const SkinAnalysis = require('../models/SkinAnalysis');
const CheckIn = require('../models/CheckIn');
const ProductLog = require('../models/ProductLog');
const ActivityLog = require('../models/ActivityLog');

const PAGE_SIZE = 50;

// Fields an admin page may show. passwordHash is never selected.
const USER_FIELDS = 'firstName email googleId skincareTiming city country timezone createdAt termsAcceptedAt consentVersion';

// The search box is user input going into a MongoDB $regex. Escaping every regex
// metacharacter makes it a plain "contains" match, so input like ".*" or "(a+)+"
// can neither match everything by accident nor trigger catastrophic backtracking.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Case-insensitive "contains" on email or first name. Empty/absent search = everyone.
function userSearchFilter(q) {
  const term = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  if (!term) return {};
  const re = new RegExp(escapeRegex(term), 'i');
  return { $or: [{ email: re }, { firstName: re }] };
}

/**
 * One page of users, newest signups first, each with a summary of their quiz
 * completions. Unlike the Clients list (one row per SkinAnalysis), this includes people
 * who signed up but never finished the quiz.
 *
 * @returns {{ users: object[], total: number, page: number, pages: number, q: string }}
 */
async function listUsers({ q, page } = {}, { userModel = User, analysisModel = SkinAnalysis } = {}) {
  const filter = userSearchFilter(q);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);

  const [total, users] = await Promise.all([
    userModel.countDocuments(filter),
    userModel.find(filter)
      .select(USER_FIELDS)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
  ]);

  // One aggregate for the whole page instead of one query per row: how many quiz
  // completions each user has, and what their latest one says.
  const ids = users.map(u => u._id);
  const stats = ids.length
    ? await analysisModel.aggregate([
      { $match: { userId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$userId',
          count: { $sum: 1 },
          latestAt: { $first: '$createdAt' },
          latestEraName: { $first: '$era.name' },
          latestEraId: { $first: '$eraId' },
        },
      },
    ])
    : [];
  const byUser = new Map(stats.map(s => [String(s._id), s]));

  return {
    users: users.map(u => ({ ...u, analyses: byUser.get(String(u._id)) || { count: 0 } })),
    total,
    page: pageNum,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    q: typeof q === 'string' ? q.trim().slice(0, 100) : '',
  };
}

/**
 * Everything the user page shows about one account, or null if it does not exist.
 * All lists are newest first and capped, so one very active user cannot make the page slow.
 */
async function getUserDetail(id, models = {}) {
  const {
    userModel = User,
    analysisModel = SkinAnalysis,
    checkInModel = CheckIn,
    productLogModel = ProductLog,
    activityModel = ActivityLog,
  } = models;
  if (!mongoose.isValidObjectId(id)) return null;

  const user = await userModel.findById(id).select(USER_FIELDS).lean();
  if (!user) return null;

  const [analyses, checkIns, products, activity] = await Promise.all([
    analysisModel.find({ userId: user._id })
      .select('eraId era.name createdAt clinicNotifiedAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    checkInModel.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30).lean(),
    productLogModel.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    // ip is deliberately not selected: the page has no use for it.
    activityModel.find({ userId: user._id }).select('event location.city location.country createdAt')
      .sort({ createdAt: -1 }).limit(100).lean(),
  ]);

  return { user, analyses, checkIns, products, activity };
}

module.exports = { PAGE_SIZE, escapeRegex, userSearchFilter, listUsers, getUserDetail };
