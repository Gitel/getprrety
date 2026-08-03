const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const { consumeRateLimit } = require('../services/rateLimit');

function cleanRecommendationList(value, maxIndex) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxIndex).map(item => {
    const index = Number(item?.index);
    const rec = item?.rec;
    if (!Number.isInteger(index) || index < 0 || index >= maxIndex || !rec || typeof rec !== 'object') return null;
    const rawUrl = typeof rec.url === 'string' ? rec.url.trim() : '';
    return {
      index,
      rec: {
        brand: String(rec.brand || '').slice(0, 100),
        name: String(rec.name || '').slice(0, 160),
        price: String(rec.price || '').slice(0, 50),
        retailer: String(rec.retailer || '').slice(0, 100),
        url: /^https:\/\//i.test(rawUrl) ? rawUrl.slice(0, 1000) : '',
      },
    };
  }).filter(Boolean);
}

router.post('/product-recommendations', requireAuth, async (req, res) => {
  try {
    const allowed = await consumeRateLimit(
      'ai_user',
      req.user.id,
      process.env.AI_REQUESTS_PER_USER_HOUR || 10
    );
    if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const model = process.env.ANTHROPIC_MODEL;
    if (!apiKey || !model) return res.status(503).json({ error: 'Recommendations are unavailable' });

    const { productAudit = {}, country = '', eraName = '' } = req.body || {};
    const add = Array.isArray(productAudit.add) ? productAudit.add.slice(0, 10) : [];
    const replace = Array.isArray(productAudit.replace) ? productAudit.replace.slice(0, 10) : [];
    if (!add.length && !replace.length) return res.json({ add: [], replace: [] });

    const safeCountry = String(country).slice(0, 100);
    const safeEra = String(eraName).slice(0, 100);
    const needs = [
      ...add.map((item, index) => `[add_${index}] [ADD] ${String(item.product || '').slice(0, 200)}`),
      ...replace.map((item, index) =>
        `[replace_${index}] [REPLACE] ${String(item.from || '').slice(0, 120)} with ${String(item.to || '').slice(0, 200)}`
      ),
    ].join('\n');

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: 'Recommend reputable skincare products available in the requested country. Return only valid JSON.',
        messages: [{
          role: 'user',
          content: `Country: ${safeCountry}\nSkin Era: ${safeEra}\n\n${needs}\n\nReturn {"add":[{"index":0,"rec":{"brand":"","name":"","price":"","url":"","retailer":""}}],"replace":[]}`,
        }],
      }),
    });
    if (!upstream.ok) return res.status(502).json({ error: 'Recommendation service failed' });

    const data = await upstream.json();
    const raw = (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('');
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json({
      add: cleanRecommendationList(parsed?.add, add.length),
      replace: cleanRecommendationList(parsed?.replace, replace.length),
    });
  } catch {
    res.status(502).json({ error: 'Recommendation service failed' });
  }
});

module.exports = router;
