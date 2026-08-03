const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const router = require('express').Router();
const SkinScan = require('../models/SkinScan');
const requireAuth = require('../middleware/auth');
const client = require('../services/perfectcorp/client');
const poller = require('../jobs/skinScanPoller');
const { AnalysisError } = require('../services/perfectcorp/errors');
const { consumeRateLimit } = require('../services/rateLimit');
const { sanitizeQuizAnswers } = require('../services/sanitizeQuizAnswers');

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];
const ANGLES = ['front', 'left', 'right'];

function decodeImage(base64, contentType) {
  const encoded = base64.replace(/\s/g, '');
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((contentType === 'image/jpeg' && !jpeg) || (contentType === 'image/png' && !png)) return null;
  return bytes;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function ipHash(req) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for scan rate limiting');
  return crypto.createHmac('sha256', secret).update(requestIp(req)).digest('hex');
}

function scanToken(req) {
  return req.headers['x-scan-token'];
}

function hasScanAccess(scan, token) {
  if (!scan?.accessTokenHash || typeof token !== 'string') return false;
  const provided = Buffer.from(sha256(token));
  const expected = Buffer.from(scan.accessTokenHash);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function authenticatedOwner(req, scan) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || !scan?.userId) return false;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    return String(payload.id) === String(scan.userId);
  } catch {
    return false;
  }
}

async function findScanWithSecret(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return SkinScan.findById(id).select('+accessTokenHash');
}

async function enforceAnonymousBudget(req) {
  const perIpLimit = Number(process.env.SKIN_SCAN_PER_IP_HOURLY_LIMIT || 3);
  const globalLimit = Number(process.env.SKIN_SCAN_GLOBAL_HOURLY_LIMIT || 100);
  const hash = ipHash(req);
  const [perIpAllowed, globalAllowed] = await Promise.all([
    consumeRateLimit('scan_ip', hash, perIpLimit),
    consumeRateLimit('scan_global', 'all', globalLimit),
  ]);
  if (!perIpAllowed || !globalAllowed) {
    const err = new Error('Skin scan rate limit exceeded');
    err.status = 429;
    throw err;
  }
  return hash;
}

// Photos are captured before signup, so init is anonymous but tightly budgeted. A random capability
// token protects every subsequent action; only its SHA-256 hash is stored.
router.post('/init', async (req, res) => {
  let scan;
  try {
    const { photos, quizAnswers } = req.body;
    if (!Array.isArray(photos) || photos.length < 1 || photos.length > ANGLES.length) {
      return res.status(400).json({ error: 'One to three photos are required' });
    }

    const valid = [];
    const seen = new Set();
    for (const p of photos) {
      if (!p || !ANGLES.includes(p.angle) || seen.has(p.angle) || typeof p.base64 !== 'string') {
        return res.status(400).json({ error: 'Invalid or duplicate photo angle' });
      }
      if (!ALLOWED_TYPES.includes(p.contentType)) {
        return res.status(400).json({ error: `Unsupported contentType for ${p.angle}` });
      }
      const bytes = decodeImage(p.base64, p.contentType);
      if (!bytes) return res.status(400).json({ error: `Invalid image data for ${p.angle}` });
      if (bytes.length > MAX_BYTES) {
        return res.status(400).json({ error: `Photo too large: ${p.angle}` });
      }
      seen.add(p.angle);
      valid.push({ ...p, bytes });
    }
    if (!seen.has('front')) return res.status(400).json({ error: 'A front photo is required' });

    const requestIpHash = await enforceAnonymousBudget(req);
    const accessToken = crypto.randomBytes(32).toString('base64url');
    scan = await SkinScan.create({
      status: 'awaiting_upload',
      accessTokenHash: sha256(accessToken),
      requestIpHash,
      quizSnapshot: sanitizeQuizAnswers(quizAnswers),
      sidePhotoAnalysisEnabled: process.env.SIDE_PHOTO_ANALYSIS_ENABLED !== 'false',
      tasks: valid.map(p => ({ angle: p.angle, status: 'pending' })),
    });

    const slots = await client.requestFileSlots(
      valid.map(p => ({ contentType: p.contentType, fileName: `${p.angle}.${p.contentType === 'image/png' ? 'png' : 'jpg'}`, fileSize: p.bytes.length }))
    );
    if (slots.length !== valid.length || slots.some(slot => !slot?.url || !slot?.file_id)) {
      throw new AnalysisError('UPLOAD_INCOMPLETE', 'Vendor did not return every upload slot');
    }

    await Promise.all(valid.map(async (p, i) => {
      const slot = slots[i];
      await client.putToPresignedUrl(slot.url, p.bytes, slot.headers);
      await SkinScan.updateOne(
        { _id: scan._id, 'tasks.angle': p.angle },
        { $set: { 'tasks.$.fileId': slot.file_id } }
      );
    }));

    res.status(201).json({ scanId: scan._id, scanToken: accessToken, angles: valid.map(p => p.angle) });
  } catch (err) {
    if (scan?._id) await SkinScan.deleteOne({ _id: scan._id }).catch(() => {});
    if (err instanceof AnalysisError) {
      return res.status(502).json({ error: err.code, userMessage: err.userMessage, recoverable: err.recoverable });
    }
    res.status(err.status || 500).json({ error: err.status === 429 ? 'RATE_LIMITED' : 'Internal server error' });
  }
});

// Atomic state transition makes start idempotent: the same scan can never create a second set of
// paid vendor tasks, even when clients retry concurrently.
router.post('/:id/start', async (req, res) => {
  let lockedScanId;
  try {
    const existing = await findScanWithSecret(req.params.id);
    if (!existing || !hasScanAccess(existing, scanToken(req))) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    if (['starting', 'processing', 'complete'].includes(existing.status)) {
      return res.json({ scanId: existing._id, status: existing.status });
    }
    if (existing.status === 'failed') return res.status(409).json({ error: 'SCAN_FAILED' });

    const scan = await SkinScan.findOneAndUpdate(
      { _id: existing._id, status: 'awaiting_upload' },
      { $set: { status: 'starting' } },
      { new: true }
    );
    if (!scan) return res.status(409).json({ error: 'SCAN_ALREADY_STARTED' });
    lockedScanId = scan._id;

    const uploaded = scan.tasks.filter(t => t.fileId)
      .sort((a, b) => ANGLES.indexOf(a.angle) - ANGLES.indexOf(b.angle));
    if (!uploaded.length || uploaded[0].angle !== 'front') {
      await SkinScan.updateOne({ _id: scan._id }, { $set: { status: 'failed', failureReason: 'UPLOAD_INCOMPLETE' } });
      return res.status(409).json({ error: 'UPLOAD_INCOMPLETE' });
    }

    const startedAngles = [];
    for (const task of uploaded) {
      try {
        const taskId = await client.createTask(task.fileId);
        if (!taskId) throw new AnalysisError('VENDOR_UNAVAILABLE', 'Vendor did not return a task id');
        await SkinScan.updateOne(
          { _id: scan._id, 'tasks.angle': task.angle },
          { $set: { 'tasks.$.taskId': taskId, 'tasks.$.status': 'processing' } }
        );
        startedAngles.push(task.angle);
      } catch (err) {
        await SkinScan.updateOne(
          { _id: scan._id, 'tasks.angle': task.angle },
          { $set: { 'tasks.$.status': 'error', 'tasks.$.error': err.code || 'VENDOR_UNAVAILABLE' } }
        );
        if (task.angle === 'front') break;
      }
    }

    if (!startedAngles.includes('front')) {
      await SkinScan.updateOne({ _id: scan._id }, {
        $set: { status: 'failed', failureReason: 'VENDOR_UNAVAILABLE', completedAt: new Date() },
      });
      return res.status(502).json({ error: 'VENDOR_UNAVAILABLE' });
    }

    await SkinScan.updateOne({ _id: scan._id }, { $set: { status: 'processing' } });
    poller.startPolling(scan._id, startedAngles);
    res.json({ scanId: scan._id, status: 'processing' });
  } catch (err) {
    if (lockedScanId) {
      await SkinScan.updateOne(
        { _id: lockedScanId, status: 'starting' },
        { $set: { status: 'failed', failureReason: 'VENDOR_UNAVAILABLE', completedAt: new Date() } }
      ).catch(() => {});
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const scan = await findScanWithSecret(req.params.id);
    if (!scan || (!hasScanAccess(scan, scanToken(req)) && !authenticatedOwner(req, scan))) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    if (scan.status === 'processing') {
      const angles = scan.tasks.filter(t => t.status === 'processing' && t.taskId).map(t => t.angle);
      poller.startPolling(scan._id, angles);
    }
    if (scan.status === 'complete') {
      return res.json({ status: 'complete', skinScan: { merged: scan.merged, fusion: scan.fusion } });
    }
    if (scan.status === 'failed') {
      return res.json({ status: 'failed', reason: scan.failureReason, recoverable: true });
    }
    res.json({ status: scan.status, elapsedMs: Date.now() - scan.createdAt.getTime() });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/claim', requireAuth, async (req, res) => {
  try {
    const token = scanToken(req);
    if (typeof token !== 'string' || !mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    const scan = await SkinScan.findOneAndUpdate(
      {
        _id: req.params.id,
        accessTokenHash: sha256(token),
        $or: [{ userId: null }, { userId: req.user.id }],
      },
      { $set: { userId: req.user.id } },
      { new: true }
    );
    if (!scan) {
      return res.status(409).json({ error: 'Scan already claimed' });
    }
    res.json({ scanId: scan._id });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
