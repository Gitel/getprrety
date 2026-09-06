const mongoose = require('mongoose');
const router = require('express').Router();
const SkinAnalysis = require('../models/SkinAnalysis');
const SkinScan = require('../models/SkinScan');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { sanitizeQuizAnswers } = require('../services/sanitizeQuizAnswers');
const { notifyClinic } = require('../services/clinicNotify');
const { saveAnalysis } = require('../services/saveAnalysis');

function locationFromQuizAnswers(answers) {
  const city = typeof answers?.city === 'string' ? answers.city.trim().slice(0, 160) : '';
  if (!city) return null;

  const country = typeof answers.country === 'string' && /^[A-Za-z]{2}$/.test(answers.country.trim())
    ? answers.country.trim().toUpperCase()
    : null;
  const lat = typeof answers.lat === 'number' && Number.isFinite(answers.lat) && answers.lat >= -90 && answers.lat <= 90
    ? answers.lat
    : null;
  const lng = typeof answers.lng === 'number' && Number.isFinite(answers.lng) && answers.lng >= -180 && answers.lng <= 180
    ? answers.lng
    : null;
  const timezone = typeof answers.timezone === 'string' && answers.timezone.trim()
    ? answers.timezone.trim().slice(0, 100)
    : null;

  return { city, country, lat, lng, timezone };
}

async function withSkinScan(doc, userId) {
  if (!doc) return null;
  const analysis = doc.toObject ? doc.toObject() : { ...doc };
  if (!analysis.skinScanId) return analysis;
  const scan = await SkinScan.findOne({ _id: analysis.skinScanId, userId, status: 'complete' })
    .select('merged fusion');
  if (scan) analysis.skinScan = { merged: scan.merged, fusion: scan.fusion };
  return analysis;
}

router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      eraId, era, skinAnalysis, keyInsights, productAudit, routine, affirmation, quizAnswers, quizPhotoIds, skinScanId,
    } = req.body;
    if (!eraId) return res.status(400).json({ error: 'eraId is required' });

    // Idempotency key from the client's retry loop. Absent for older builds, which
    // keep the previous behavior.
    const clientRequestId = typeof req.body.clientRequestId === 'string' && req.body.clientRequestId.trim()
      ? req.body.clientRequestId.trim().slice(0, 100)
      : null;

    let ownedScanId = null;
    if (skinScanId) {
      if (!mongoose.isValidObjectId(skinScanId)) return res.status(400).json({ error: 'Invalid skinScanId' });
      const owned = await SkinScan.exists({ _id: skinScanId, userId: req.user.id });
      if (!owned) return res.status(403).json({ error: 'Skin scan is not owned by this user' });
      ownedScanId = skinScanId;
    }

    const cleanQuizAnswers = sanitizeQuizAnswers(quizAnswers);
    const referralSource = typeof cleanQuizAnswers.referralSource === 'string' && cleanQuizAnswers.referralSource.trim()
      ? cleanQuizAnswers.referralSource.trim().slice(0, 60)
      : null;
    const { doc, created } = await saveAnalysis({
      userId: req.user.id,
      skinScanId: ownedScanId,
      eraId,
      era,
      skinAnalysis,
      keyInsights,
      productAudit,
      routine,
      affirmation,
      quizAnswers: cleanQuizAnswers,
      quizPhotoIds: Array.isArray(quizPhotoIds) ? quizPhotoIds.slice(0, 20) : [],
      referralSource,
      clientRequestId,
    });

    if (created) {
      const location = locationFromQuizAnswers(cleanQuizAnswers);
      if (location) await User.findByIdAndUpdate(req.user.id, location, { runValidators: true });
    }
    // 200 rather than 201 on a recognised retry: nothing new was created.
    res.status(created ? 201 : 200).json({ analysis: await withSkinScan(doc, req.user.id) });

    // Notify the clinic that a new client finished their skin reading. Fire-and-forget:
    // a mail failure must never break analysis save. Gated on `created` because
    // clinicNotifiedAt only guards re-sends for one document — a duplicate document
    // used to slip straight past it and email the clinic twice.
    // Assumption: fires for every quiz completion, since the clinic is currently the only
    // acquisition channel. When a second channel exists, gate on referralSource === 'lu_clinic'.
    if (created) notifyClinic(doc).catch(err => console.error('Clinic notification failed:', err));
  } catch {
    res.status(500).json({ error: 'Unable to save analysis' });
  }
});

router.patch('/latest/photos', requireAuth, async (req, res) => {
  try {
    const quizPhotoIds = Array.isArray(req.body.quizPhotoIds) ? req.body.quizPhotoIds.slice(0, 20) : [];
    const doc = await SkinAnalysis.findOneAndUpdate(
      { userId: req.user.id },
      { $push: { quizPhotoIds: { $each: quizPhotoIds } } },
      { new: true, sort: { createdAt: -1 } }
    );
    if (!doc) return res.status(404).json({ error: 'No analysis found' });
    res.json({ analysis: await withSkinScan(doc, req.user.id) });
  } catch {
    res.status(500).json({ error: 'Unable to attach photos' });
  }
});

router.get('/latest', requireAuth, async (req, res) => {
  try {
    const doc = await SkinAnalysis.findOne({ userId: req.user.id }).sort({ createdAt: -1 });
    if (!doc) return res.status(404).json({ error: 'No analysis found' });
    res.json({ analysis: await withSkinScan(doc, req.user.id) });
  } catch {
    res.status(500).json({ error: 'Unable to load analysis' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await SkinAnalysis.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(10);
    res.json({ analyses: docs });
  } catch {
    res.status(500).json({ error: 'Unable to load analyses' });
  }
});

module.exports = router;
module.exports.locationFromQuizAnswers = locationFromQuizAnswers;
