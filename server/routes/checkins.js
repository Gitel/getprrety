const router      = require('express').Router();
const CheckIn     = require('../models/CheckIn');
const requireAuth = require('../middleware/auth');

// POST /api/checkins
router.post('/', requireAuth, async (req, res) => {
  try {
    const { mood } = req.body;
    if (!mood) return res.status(400).json({ error: 'mood is required' });
    const doc = await CheckIn.create({ userId: req.user.id, mood });
    res.status(201).json({ checkIn: doc });
  } catch (err) {
    res.status(500).json({ error: 'Unable to save check-in' });
  }
});

// GET /api/checkins  — last 30 check-ins
router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await CheckIn.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(30);
    res.json({ checkIns: docs });
  } catch (err) {
    res.status(500).json({ error: 'Unable to load check-ins' });
  }
});

module.exports = router;
