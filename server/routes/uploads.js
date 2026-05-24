const router      = require('express').Router();
const multer      = require('multer');
const Upload      = require('../models/Upload');
const requireAuth = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 }, // 8 MB per image
});

// POST /api/uploads  — multipart form-data, field name: "image"
router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file received' });
    const doc = await Upload.create({
      userId:   req.user.id,
      data:     req.file.buffer,
      mimeType: req.file.mimetype,
      size:     req.file.size,
    });
    res.status(201).json({ uploadId: doc._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
