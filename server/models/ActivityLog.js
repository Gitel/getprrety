const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  event:   {
    type: String,
    enum: ['signup', 'login', 'app_open', 'logout', 'checkin', 'analysis_complete', 'analysis_save_failed'],
    required: true,
  },
  location: {
    lat:     Number,
    lng:     Number,
    city:    String,
    region:  String,
    country: String,
  },
  ip: String,
}, { timestamps: true });

activityLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
