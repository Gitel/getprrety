const router      = require('express').Router();
const ProductLog  = require('../models/ProductLog');
const requireAuth = require('../middleware/auth');

// POST /api/products
router.post('/', requireAuth, async (req, res) => {
  try {
    const { photoUri, productName, category, notes } = req.body;
    const doc = await ProductLog.create({ userId: req.user.id, photoUri, productName, category, notes });
    res.status(201).json({ product: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products
router.get('/', requireAuth, async (req, res) => {
  try {
    const docs = await ProductLog.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({ products: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
