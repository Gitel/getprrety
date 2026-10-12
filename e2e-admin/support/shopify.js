// Helpers shared by the admin specs that need (a) a fake Shopify `orders/paid` webhook and
// (b) direct access to the IN-MEMORY test database. Nothing here touches a real service.
import { expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JWT_SECRET, SHOPIFY_WEBHOOK_SECRET, SHOPIFY_CONSULTATION_VARIANT_ID } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Use the SERVER's own node_modules (mongoose, jsonwebtoken); e2e-admin has none.
const serverRequire = createRequire(path.resolve(here, '../../server/package.json'));

export const WEBHOOK_URL = '/api/payments/shopify/orders-paid';

// Runs fn({ Booking, User, LoginLink, mongoose }) against the in-memory DB, then disconnects.
// Safety guard: refuses any URI that is not the local memory server.
export async function withDb(fn) {
  const { uri } = JSON.parse(readFileSync(path.join(here, '..', '.tmp', 'db.json'), 'utf8'));
  expect(uri).toMatch(/^mongodb:\/\/(127\.0\.0\.1|localhost)/);
  const mongoose = serverRequire('mongoose');
  await mongoose.connect(uri);
  try {
    return await fn({
      mongoose,
      Booking: serverRequire('./models/Booking.js'),
      User: serverRequire('./models/User.js'),
      LoginLink: serverRequire('./models/LoginLink.js'),
    });
  } finally {
    await mongoose.disconnect();
  }
}

// Inserts a User into the in-memory DB and returns { id, email, token } with a user JWT signed
// like server/routes/auth.js does (payload { id, email }, the test JWT_SECRET).
export async function createUser(email, firstName) {
  const jwt = serverRequire('jsonwebtoken');
  return withDb(async ({ User }) => {
    const user = await User.create({ email, firstName, passwordHash: 'not-a-real-hash' });
    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    return { id: String(user._id), email: user.email, token };
  });
}

let orderCounter = 9000000;
// A fresh, unique fake Shopify order id (a number, like Shopify's).
export const nextOrderId = () => ++orderCounter;

// The body of a Shopify `orders/paid` webhook for the consultation product.
// Overrides: variantId, noAttribute, orderId, amount.
export function buildOrder({ bookingId, email, orderId = nextOrderId(), variantId, noAttribute = false, amount = '290.00' }) {
  return {
    id: orderId,
    email,
    financial_status: 'paid',
    total_price: amount,
    currency: 'ILS',
    test: false,
    note_attributes: noAttribute ? [] : [{ name: 'getpretty_booking', value: String(bookingId) }],
    line_items: [{ variant_id: Number(variantId ?? SHOPIFY_CONSULTATION_VARIANT_ID), quantity: 1 }],
  };
}

// Shopify signs the EXACT raw body: base64(HMAC-SHA256(secret, rawBody)).
export const sign = (rawBody, secret = SHOPIFY_WEBHOOK_SECRET) =>
  createHmac('sha256', secret).update(rawBody).digest('base64');

// Posts a webhook. The order is serialized ONCE and the same string is signed and sent, so the
// signature matches byte for byte. Options: topic, signature ('bad' | 'none' | undefined = valid).
export function postWebhook(request, order, { topic = 'orders/paid', signature } = {}) {
  const raw = JSON.stringify(order);
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Topic': topic,
    'X-Shopify-Webhook-Id': `wh-${order.id}-${Math.random().toString(36).slice(2)}`,
  };
  if (signature === 'bad') headers['X-Shopify-Hmac-Sha256'] = sign(raw, 'some-other-secret');
  else if (signature !== 'none') headers['X-Shopify-Hmac-Sha256'] = sign(raw);
  return request.post(WEBHOOK_URL, { headers, data: raw });
}

// Convenience: a valid, signed `orders/paid` for a booking; returns { res, order }.
export async function payBooking(request, booking, user, extra = {}) {
  const order = buildOrder({ bookingId: booking.id, email: user.email, ...extra });
  const res = await postWebhook(request, order);
  return { res, order };
}

// Makes a hold look expired WITHOUT waiting 15 minutes: moves holdExpiresAt into the past.
// (The server's expireHolds() then flips it to 'expired' on its next read or 60 s sweep; the
// payment code must accept a late payment on a pending OR expired row.)
export const forceHoldStale = bookingId => withDb(({ Booking }) =>
  Booking.updateOne({ _id: bookingId }, { $set: { holdExpiresAt: new Date(Date.now() - 60 * 1000) } }));

export const bearer = user => ({ Authorization: `Bearer ${user.token}` });
