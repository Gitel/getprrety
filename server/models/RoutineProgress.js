const mongoose = require('mongoose');

// Which routine steps a user ticked off on Home, one document per user per day.
// Before this, ticks were React state only and reset every time the app opened.
const routineProgressSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The user's LOCAL calendar day as 'YYYY-MM-DD', sent by the app: "today" must follow
  // the user's clock, not the server's UTC day.
  date:       { type: String, required: true },
  // Short signature of the routine these ticks belong to (computed by the app from the
  // step names). A retake mid-day changes it, so old ticks never land on new steps.
  routineKey: { type: String, default: '' },
  am:         { type: [Number], default: [] }, // indices of completed morning steps
  pm:         { type: [Number], default: [] }, // indices of completed evening steps
}, { timestamps: true });

routineProgressSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('RoutineProgress', routineProgressSchema);
