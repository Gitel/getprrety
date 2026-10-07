const router      = require('express').Router();
const multer      = require('multer');
const Upload      = require('../models/Upload');
const requireAuth = require('../middleware/auth');
const { detectImageType } = require('../services/imageType');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 1 }, // 8 MB per image
});

// POST /api/uploads  — multipart form-data, field name: "image"
router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file received' });
    // Shared magic-byte check (services/imageType.js): 'image/jpeg', 'image/png' or null.
    const mimeType = detectImageType(req.file.buffer);
    if (!mimeType) return res.status(400).json({ error: 'Only JPEG and PNG images are supported' });
    const doc = await Upload.create({
      userId:   req.user.id,
      data:     req.file.buffer,
      mimeType,
      size:     req.file.size,
    });
    res.status(201).json({ uploadId: doc._id });
  } catch (err) {
    res.status(500).json({ error: 'Unable to upload image' });
  }
});

// GET /api/uploads/:id  — serve the image binary
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const doc = await Upload.findOne({ _id: req.params.id, userId: req.user.id });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.set('Content-Type', doc.mimeType);
    res.set('Cache-Control', 'private, max-age=31536000');
    res.send(doc.data);
  } catch (err) {
    res.status(500).json({ error: 'Unable to load image' });
  }
});

module.exports = router;
