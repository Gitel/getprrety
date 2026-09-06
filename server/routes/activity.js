const router      = require('express').Router();
const ActivityLog = require('../models/ActivityLog');
const requireAuth = require('../middleware/auth');

// POST /api/activity  — log an event
router.post('/', requireAuth, async (req, res) => {
  try {
    const { event, location } = req.body;
    const ip = req.ip || req.socket.remoteAddress;

    const doc = await ActivityLog.create({
      userId: req.user.id,
      event,
      location: location || undefined,
      ip,
    });
    res.status(201).json({ log: doc });
  } catch (err) {
    // A rejected enum value is the client's problem, not the server's. Reporting it
    // as 500 is what let an unknown event go unnoticed in the first place.
    if (err.name === 'ValidationError') return res.status(400).json({ error: 'Unknown activity event' });
    res.status(500).json({ error: 'Unable to save activity' });
  }
});

// GET /api/activity  — last 100 events for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await ActivityLog.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ logs: docs });
  } catch (err) {
    res.status(500).json({ error: 'Unable to load activity' });
  }
});

module.exports = router;
