// Permanently delete a user and everything stored about them (owner decision: hard delete).
// Used by POST /admin/users/:id/delete. There is no undo.
const mongoose = require('mongoose');
const User = require('../models/User');
const SkinAnalysis = require('../models/SkinAnalysis');
const SkinScan = require('../models/SkinScan');
const Upload = require('../models/Upload');
const CheckIn = require('../models/CheckIn');
const ProductLog = require('../models/ProductLog');
const ActivityLog = require('../models/ActivityLog');
const Message = require('../models/Message');
// Home step ticks (one document per user per day), added by the Gemini wiring branch.
const RoutineProgress = require('../models/RoutineProgress');
// Consultation bookings: upcoming ones also own a Google Calendar event that must be released.
const Booking = require('../models/Booking');
const { releaseUserBookings } = require('./bookings');

// Every collection that stores a document per user, keyed by `userId`. When a new
// per-user model is added, it must be added here too, or deleting a user leaves it behind.
// Deliberately NOT here:
//  - AdminAuditLog: the record that an admin deleted this user (it keeps only the id)
//  - RateLimitBucket: anonymous counters that expire on their own (TTL index)
const USER_DATA = { SkinAnalysis, SkinScan, Upload, CheckIn, ProductLog, ActivityLog, Message, RoutineProgress, Booking };

/**
 * @param {string} id               The user's id.
 * @param {string} confirmEmail     What the admin typed; must equal the account email.
 * @param {object} [deps]           { userModel, dataModels, releaseBookings } - injected for tests.
 * @returns {{ ok: true, counts: object } | { ok: false, code: 'user_notfound' | 'delete_confirm_mismatch' }}
 */
async function deleteUserAndData(id, confirmEmail, { userModel = User, dataModels = USER_DATA, releaseBookings = releaseUserBookings } = {}) {
  if (!mongoose.isValidObjectId(id)) return { ok: false, code: 'user_notfound' };
  const user = await userModel.findById(id).select('email').lean();
  if (!user) return { ok: false, code: 'user_notfound' };

  // Typing the email is the "are you sure": it has to be this account's exact address.
  const typed = typeof confirmEmail === 'string' ? confirmEmail.trim().toLowerCase() : '';
  if (typed !== user.email) return { ok: false, code: 'delete_confirm_mismatch' };

  // Remove the user's upcoming calendar events while their booking rows still exist. Only when
  // bookings are part of the data being deleted (tests with fake models skip it). A failure
  // must never block the deletion: the account is always deletable.
  if (dataModels.Booking) {
    try {
      await releaseBookings(user._id);
    } catch (err) {
      console.error('Releasing bookings before account deletion failed:', err.message);
    }
  }

  // Data first, the account last. If anything fails halfway, the account still exists,
  // so the admin still has its page and can simply retry. Deleting the account first
  // would strand the remaining data with no page left to reach it from.
  const counts = {};
  for (const [name, model] of Object.entries(dataModels)) {
    const result = await model.deleteMany({ userId: user._id });
    counts[name] = (result && result.deletedCount) || 0;
  }
  await userModel.deleteOne({ _id: user._id });
  return { ok: true, counts };
}

module.exports = { deleteUserAndData, USER_DATA };
