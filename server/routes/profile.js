const router      = require('express').Router();
const User        = require('../models/User');
const requireAuth = require('../middleware/auth');

// GET /api/profile
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found', code: 'user_not_found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Unable to load profile', code: 'profile_load_failed' });
  }
});

// PATCH /api/profile
router.patch('/', requireAuth, async (req, res) => {
  try {
    const allowed = ['firstName', 'skinEra', 'skincareTiming', 'selfiePhotoIds', 'shelfPhotoIds', 'language'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    // Reject an unsupported language up front: left to runValidators it would surface as a
    // generic 500. null is allowed (it clears the saved choice).
    if ('language' in updates && !['en', 'he', null].includes(updates.language))
      return res.status(400).json({ error: 'Unsupported language', code: 'invalid_language' });
    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, runValidators: true }
    ).select('-passwordHash');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Unable to update profile', code: 'profile_update_failed' });
  }
});

module.exports = router;
