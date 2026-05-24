const router       = require('express').Router();
const SkinAnalysis = require('../models/SkinAnalysis');
const requireAuth  = require('../middleware/auth');

// POST /api/analysis  — save a new analysis
router.post('/', requireAuth, async (req, res) => {
  try {
    const { eraId, era, skinAnalysis, keyInsights, productAudit, routine, affirmation, quizAnswers } = req.body;
    const doc = await SkinAnalysis.create({
      userId: req.user.id,
      eraId, era, skinAnalysis, keyInsights, productAudit, routine, affirmation, quizAnswers,
    });
    res.status(201).json({ analysis: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/analysis/latest/photos  — attach uploaded photo IDs to the most recent analysis
router.patch('/latest/photos', requireAuth, async (req, res) => {
  try {
    const { quizPhotoIds } = req.body;
    const doc = await SkinAnalysis.findOneAndUpdate(
      { userId: req.user.id },
      { $push: { quizPhotoIds: { $each: quizPhotoIds || [] } } },
      { new: true, sort: { createdAt: -1 } }
    );
    if (!doc) return res.status(404).json({ error: 'No analysis found' });
    res.json({ analysis: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analysis/latest  — most recent analysis for this user
router.get('/latest', requireAuth, async (req, res) => {
  try {
    const doc = await SkinAnalysis.findOne({ userId: req.user.id }).sort({ createdAt: -1 });
    if (!doc) return res.status(404).json({ error: 'No analysis found' });
    res.json({ analysis: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analysis  — all analyses (history)
router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await SkinAnalysis.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(10);
    res.json({ analyses: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
