// Shopify webhook receiver: POST /api/payments/shopify/orders-paid
// index.js mounts this router with express.raw() BEFORE the global express.json(), because the
// HMAC signature must be checked against the exact bytes Shopify sent (a re-serialised JSON
// body would not match). So req.body here is a Buffer, not an object.
const express = require('express');
const crypto = require('crypto');
const { recordPayment, syncCalendarEvents } = require('../services/bookingPayments');
const { recordOrder } = require('../services/shopifyConsultations');

const router = express.Router();

// Constant-time comparison of the base64 HMAC. timingSafeEqual throws on different lengths,
// so the length is checked first.
function signatureValid(secret, rawBody, header) {
  if (typeof header !== 'string' || !header) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('base64'));
  const given = Buffer.from(header);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

async function ordersPaid(req, res) {
  // 1. Not configured: refuse (and never accept unsigned calls).
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || '';
  if (!secret) return res.status(503).json({ code: 'payments_not_configured' });

  // 2. Signature over the RAW body.
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!signatureValid(secret, raw, req.headers['x-shopify-hmac-sha256'])) {
    return res.status(401).json({ code: 'invalid_signature' });
  }

  // 3. Only paid orders matter; acknowledge the rest so Shopify does not retry them.
  if (req.headers['x-shopify-topic'] !== 'orders/paid') return res.status(200).json({ ok: true, result: 'ignored_topic' });

  // 4. Body.
  let order;
  try {
    order = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ code: 'invalid_body' });
  }
  if (!order || typeof order !== 'object' || order.id === undefined || order.id === null) {
    return res.status(400).json({ code: 'invalid_body' });
  }

  // 5. Which booking is this order for? The app puts its id in the cart attribute.
  const attrs = Array.isArray(order.note_attributes) ? order.note_attributes : [];
  const attr = attrs.find(a => a && a.name === 'getpretty_booking');

  // 6. Is the consultation product in the order? (ids compared as strings: Shopify sends numbers)
  const variantId = process.env.SHOPIFY_CONSULTATION_VARIANT_ID || '';
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  const hasConsultation = Boolean(variantId) && items.some(i => i && String(i.variant_id) === variantId);

  if (!attr || !attr.value) {
    // Any other product bought in the store: not ours.
    if (!hasConsultation) return res.status(200).json({ ok: true, result: 'no_booking_attribute' });
    // A consultation bought DIRECTLY in the Shopify store (not from the app). The customer picks
    // the time on the clinic's appointment page, so we only remember the order; the sweep in
    // services/shopifyConsultations.js finds the appointment in the calendar later.
    try {
      const outcome = await recordOrder(order);
      return res.status(200).json({ ok: true, result: outcome.result });
    } catch (err) {
      // 500 so Shopify retries the delivery later.
      console.error(`POST /api/payments/shopify/orders-paid: recordOrder failed for order ${order.id} (${err && err.name})`);
      return res.status(500).json({ code: 'order_record_failed' });
    }
  }
  if (!hasConsultation) return res.status(200).json({ ok: true, result: 'wrong_product' });

  // 7. Record the payment. A thrown error answers 500 so Shopify retries the delivery.
  let outcome;
  try {
    outcome = await recordPayment({
      bookingId: String(attr.value), orderId: String(order.id), amount: Number(order.total_price), currency: order.currency,
    });
  } catch (err) {
    console.error(`POST /api/payments/shopify/orders-paid: recordPayment failed for order ${order.id} (${err && err.name})`);
    return res.status(500).json({ code: 'payment_failed' });
  }
  res.status(200).json({ ok: true, result: outcome.result });

  // 8. After answering (Shopify wants a fast reply): write the calendar event.
  setImmediate(() => {
    Promise.resolve(syncCalendarEvents()).catch(err => {
      console.error(`payments: calendar sync after webhook failed (${err && err.name})`);
    });
  });
}

router.post('/shopify/orders-paid', ordersPaid);

module.exports = router;
