const router = require('express').Router();
const City = require('../models/City');
const { buildCityPrefixFilter, toCityResult } = require('../services/citySearch');

// GET /api/cities/autocomplete?q=<query>
router.get('/autocomplete', async (req, res) => {
  try {
    const filter = buildCityPrefixFilter(req.query.q);
    if (!filter) return res.json([]);

    const cities = await City.find(filter)
      .sort({ population: -1 })
      .limit(10)
      .lean();

    res.json(cities.map(toCityResult));
  } catch (err) {
    console.error('City autocomplete error:', err);
    res.status(500).json({ error: 'Unable to search cities' });
  }
});

module.exports = router;
