const router      = require('express').Router();
const mongoose    = require('mongoose');
const ProductLog  = require('../models/ProductLog');
const Upload      = require('../models/Upload');
const requireAuth = require('../middleware/auth');

// POST /api/products
router.post('/', requireAuth, async (req, res) => {
  try {
    const { uploadId, productName, category, notes } = req.body;
    if (!mongoose.isValidObjectId(uploadId)) return res.status(400).json({ error: 'A valid product photo is required' });
    const upload = await Upload.findOne({ _id: uploadId, userId: req.user.id }).select('_id');
    if (!upload) return res.status(400).json({ error: 'A valid product photo is required' });
    const doc = await ProductLog.create({
      userId: req.user.id,
      uploadId: upload._id,
      photoUri: `/api/uploads/${upload._id}`,
      productName: typeof productName === 'string' ? productName.slice(0, 120) : undefined,
      category: typeof category === 'string' ? category.slice(0, 60) : undefined,
      notes: typeof notes === 'string' ? notes.slice(0, 1000) : undefined,
    });
    res.status(201).json({ product: doc });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products
router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await ProductLog.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({ products: docs });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
