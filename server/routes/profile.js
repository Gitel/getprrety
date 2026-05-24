const router      = require('express').Router();
const User        = require('../models/User');
const requireAuth = require('../middleware/auth');

// GET /api/profile
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/profile
router.patch('/', requireAuth, async (req, res) => {
  try {
    const allowed = ['firstName', 'skinEra', 'skincareTiming', 'selfiePhotoIds'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, runValidators: true }
    ).select('-passwordHash');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
