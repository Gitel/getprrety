const router          = require('express').Router();
const RoutineProgress = require('../models/RoutineProgress');
const requireAuth     = require('../middleware/auth');

const MAX_STEPS = 50; // far above any real routine; bounds what a client can store

// 'YYYY-MM-DD' that is a real calendar date (rejects e.g. 2026-02-31).
function isCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Step indices: whole numbers 0..MAX_STEPS-1, de-duplicated and sorted. null if invalid.
function cleanIndices(value) {
  if (!Array.isArray(value) || value.length > MAX_STEPS) return null;
  if (!value.every(i => Number.isInteger(i) && i >= 0 && i < MAX_STEPS)) return null;
  return [...new Set(value)].sort((a, b) => a - b);
}

// Validates a PUT body. Returns the clean fields, or null -> 400.
function cleanProgressInput(body) {
  const date = body?.date;
  const am = cleanIndices(body?.am ?? []);
  const pm = cleanIndices(body?.pm ?? []);
  if (!isCalendarDay(date) || !am || !pm) return null;
  const routineKey = typeof body.routineKey === 'string' ? body.routineKey.slice(0, 100) : '';
  return { date, routineKey, am, pm };
}

function toPublic(doc) {
  return doc ? { date: doc.date, routineKey: doc.routineKey, am: doc.am, pm: doc.pm } : null;
}

// GET /api/routine-progress?date=YYYY-MM-DD - that day's ticks, or null.
router.get('/', requireAuth, async (req, res) => {
  try {
    if (!isCalendarDay(req.query.date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const doc = await RoutineProgress.findOne({ userId: req.user.id, date: req.query.date });
    res.json({ progress: toPublic(doc) });
  } catch {
    res.status(500).json({ error: 'Unable to load routine progress' });
  }
});

// PUT /api/routine-progress - replaces that day's ticks (upsert). The app sends the full
// am/pm lists every time, so the last write wins and no merge logic is needed.
router.put('/', requireAuth, async (req, res) => {
  try {
    const input = cleanProgressInput(req.body);
    if (!input) return res.status(400).json({ error: 'Invalid routine progress' });
    const filter = { userId: req.user.id, date: input.date };
    const update = { routineKey: input.routineKey, am: input.am, pm: input.pm };
    const options = { new: true, upsert: true, runValidators: true };
    let doc;
    try {
      doc = await RoutineProgress.findOneAndUpdate(filter, update, options);
    } catch (err) {
      // Two first-of-the-day writes can race to insert; the loser hits the unique index.
      // The document exists by then, so the same update simply succeeds on retry.
      if (err.code !== 11000) throw err;
      doc = await RoutineProgress.findOneAndUpdate(filter, update, options);
    }
    res.json({ progress: toPublic(doc) });
  } catch {
    res.status(500).json({ error: 'Unable to save routine progress' });
  }
});

module.exports = router;
module.exports.cleanProgressInput = cleanProgressInput;
module.exports.isCalendarDay = isCalendarDay;
