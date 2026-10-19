// Consultations bought DIRECTLY in the clinic's Shopify store (see models/ShopifyConsultationOrder.js).
// Plan: AI/plans/shopify-consultation-link.md.
//
// Like services/bookingPayments.js, every function takes `deps` as its LAST argument so tests can
// pass fakes (model, calendar, clock). Logs carry order ids and codes only - never emails.
const ShopifyConsultationOrder = require('../models/ShopifyConsultationOrder');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fills in the real dependencies; a test passes only the ones it wants to fake.
function withDefaults(deps = {}) {
  return { Order: ShopifyConsultationOrder, now: () => new Date(), ...deps };
}

// A date Shopify sent (e.g. order.processed_at), or null when it is missing / not a date.
function dateOrNull(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/**
 * Store a paid Shopify consultation order (called by the orders/paid webhook).
 * Safe to call many times for the same order: the first call inserts, later ones change nothing.
 * @param {object} order the Shopify order JSON (only id, name, email, processed_at, total_price
 *                       and currency are read)
 * @returns {{ ok: true, result: 'shopify_consultation_recorded' | 'already_recorded' | 'no_email' }}
 */
async function recordOrder(order, deps) {
  const d = withDefaults(deps);
  // The email links the order to an app account. Without one there is nothing we can do with
  // the order (e.g. a phone order typed in by staff), so it is acknowledged and not stored.
  const email = typeof order.email === 'string' ? order.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: true, result: 'no_email' };

  const orderId = String(order.id);
  const amount = Number(order.total_price);
  try {
    // $setOnInsert = only written when the row is created, so a re-delivery never overwrites it.
    const res = await d.Order.updateOne(
      { orderId },
      {
        $setOnInsert: {
          orderId,
          orderName: typeof order.name === 'string' ? order.name.slice(0, 40) : '',
          email,
          // When Shopify processed the payment; our clock if Shopify did not say.
          paidAt: dateOrNull(order.processed_at) || d.now(),
          amount: Number.isFinite(amount) ? amount : null,
          currency: typeof order.currency === 'string' ? order.currency.slice(0, 8) : null,
        },
      },
      { upsert: true }
    );
    return { ok: true, result: res && res.upsertedCount ? 'shopify_consultation_recorded' : 'already_recorded' };
  } catch (err) {
    // Two deliveries of the same order raced and the other one inserted first (unique orderId).
    if (err && err.code === 11000) return { ok: true, result: 'already_recorded' };
    throw err;
  }
}

module.exports = { recordOrder };
