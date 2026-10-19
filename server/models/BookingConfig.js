const mongoose = require('mongoose');

const SLOT_MINUTES = [15, 20, 30, 45, 60];

// Used the first time the settings are read (bookings.getConfig() upserts them).
// Sunday (0) to Thursday (4), 10:00-18:00 clinic time.
const DEFAULTS = {
  enabled: true,
  slotMinutes: 30,
  bufferMinutes: 0,
  leadHours: 12,
  allowSameDay: false,
  horizonDays: 90,
  timeZone: 'Asia/Jerusalem',
  weekly: [0, 1, 2, 3, 4].map(day => ({ day, open: '10:00', close: '18:00' })),
};

// A SINGLETON: the clinic has one set of booking settings, so the collection holds one
// document. The unique `key` (always 'main') stops a second one from being created.
// Weekday numbers: 0 = Sunday ... 6 = Saturday. A weekday with no entry is closed.
const bookingConfigSchema = new mongoose.Schema({
  key:           { type: String, default: 'main', unique: true },
  enabled:       { type: Boolean, default: DEFAULTS.enabled },
  slotMinutes:   { type: Number, enum: SLOT_MINUTES, default: DEFAULTS.slotMinutes },
  bufferMinutes: { type: Number, min: 0, max: 60, default: DEFAULTS.bufferMinutes },
  leadHours:     { type: Number, min: 0, max: 168, default: DEFAULTS.leadHours },
  horizonDays:   { type: Number, min: 1, max: 180, default: DEFAULTS.horizonDays },
  // false = nothing on today's clinic date is bookable (earliest is tomorrow 00:00). A stored
  // document without this field reads as false.
  allowSameDay:  { type: Boolean, default: DEFAULTS.allowSameDay },
  // Not editable from the admin page.
  timeZone:      { type: String, default: DEFAULTS.timeZone },
  weekly: {
    type: [{
      day:   { type: Number, min: 0, max: 6, required: true },
      open:  { type: String, required: true },  // 'HH:MM' clinic time
      close: { type: String, required: true },  // 'HH:MM' clinic time
    }],
    default: () => DEFAULTS.weekly.map(w => ({ ...w })),
    _id: false,
  },
}, { timestamps: true });

const BookingConfig = mongoose.model('BookingConfig', bookingConfigSchema);
BookingConfig.DEFAULTS = DEFAULTS;
BookingConfig.SLOT_MINUTES = SLOT_MINUTES;

module.exports = BookingConfig;
