// Handler-level tests for routes/payments.js (no supertest, no DB, no network): the handler is
// pulled out of the express router and called with a fake req/res. The body is a Buffer, exactly
// as express.raw() delivers it in index.js.
jest.mock('../services/bookingPayments');
jest.mock('../services/shopifyConsultations');

const crypto = require('crypto');
const payments = require('../services/bookingPayments');
const consultations = require('../services/shopifyConsultations');
const router = require('./payments');

const SECRET = 'whsec-test';
const VARIANT = '12345';
const BOOKING = 'a'.repeat(24);

const layer = router.stack.find(l => l.route && l.route.path === '/shopify/orders-paid' && l.route.methods.post);
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

const sign = (raw, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('base64');
const order = (extra = {}) => ({
  id: 777, total_price: '150.00', currency: 'ILS',
  note_attributes: [{ name: 'getpretty_booking', value: BOOKING }],
  line_items: [{ variant_id: 12345 }], // a NUMBER, as Shopify sends it
  ...extra,
});

// Builds a signed request by default; `raw`, `signature` and `topic` can be overridden.
async function call({ body = order(), raw, signature, topic = 'orders/paid' } = {}) {
  const buf = raw !== undefined ? raw : Buffer.from(JSON.stringify(body));
  const req = { body: buf, headers: { 'x-shopify-topic': topic } };
  const sig = signature !== undefined ? signature : sign(buf);
  if (sig !== null) req.headers['x-shopify-hmac-sha256'] = sig;
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
}

let errorSpy;
let immediateSpy;
beforeEach(() => {
  jest.resetAllMocks();
  process.env.SHOPIFY_WEBHOOK_SECRET = SECRET;
  process.env.SHOPIFY_CONSULTATION_VARIANT_ID = VARIANT;
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  immediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation(() => {}); // capture, do not run
  payments.recordPayment.mockResolvedValue({ ok: true, result: 'confirmed' });
  payments.syncCalendarEvents.mockResolvedValue();
  consultations.recordOrder.mockResolvedValue({ ok: true, result: 'shopify_consultation_recorded' });
});
afterEach(() => { errorSpy.mockRestore(); immediateSpy.mockRestore(); });

describe('POST /shopify/orders-paid', () => {
  test('secret not configured -> 503', async () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = '';
    const res = await call();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ code: 'payments_not_configured' });
  });

  test.each([
    ['missing header', null],
    ['wrong signature', sign(Buffer.from('other'))],
    ['short signature', 'abc'],
    ['signed with another secret', sign(Buffer.from(JSON.stringify(order())), 'wrong')],
  ])('%s -> 401 and nothing is recorded', async (_name, signature) => {
    const res = await call({ signature });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ code: 'invalid_signature' });
    expect(payments.recordPayment).not.toHaveBeenCalled();
  });

  test('a non-Buffer body (parsed by mistake) -> 401', async () => {
    const res = await call({ raw: { id: 1 }, signature: 'x' });
    expect(res.statusCode).toBe(401);
  });

  test('other topic -> 200 ignored_topic', async () => {
    const res = await call({ topic: 'orders/create' });
    expect(res).toMatchObject({ statusCode: 200, body: { ok: true, result: 'ignored_topic' } });
    expect(payments.recordPayment).not.toHaveBeenCalled();
  });

  test('signed but not JSON -> 400 invalid_body', async () => {
    const res = await call({ raw: Buffer.from('not json') });
    expect(res).toMatchObject({ statusCode: 400, body: { code: 'invalid_body' } });
  });

  test('no booking attribute and no consultation -> 200 no_booking_attribute, nothing stored', async () => {
    const res = await call({ body: order({ note_attributes: [{ name: 'other', value: 'x' }], line_items: [{ variant_id: 999 }] }) });
    expect(res).toMatchObject({ statusCode: 200, body: { ok: true, result: 'no_booking_attribute' } });
    expect(payments.recordPayment).not.toHaveBeenCalled();
    expect(consultations.recordOrder).not.toHaveBeenCalled();
  });

  // Consultation bought directly in the Shopify store (plan AI/plans/shopify-consultation-link.md).
  test('consultation WITHOUT booking attribute -> the order is stored, no booking payment', async () => {
    const body = order({ note_attributes: [], email: 'a@b.co' });
    const res = await call({ body });
    expect(res).toMatchObject({ statusCode: 200, body: { ok: true, result: 'shopify_consultation_recorded' } });
    expect(consultations.recordOrder).toHaveBeenCalledWith(body);
    expect(payments.recordPayment).not.toHaveBeenCalled();
    expect(immediateSpy).not.toHaveBeenCalled(); // no booking calendar sync for these
  });

  test('a missing note_attributes field counts as no attribute', async () => {
    const res = await call({ body: order({ note_attributes: undefined }) });
    expect(res.body.result).toBe('shopify_consultation_recorded');
  });

  test('recordOrder result is passed through (already_recorded / no_email)', async () => {
    consultations.recordOrder.mockResolvedValue({ ok: true, result: 'already_recorded' });
    expect((await call({ body: order({ note_attributes: [] }) })).body.result).toBe('already_recorded');
    consultations.recordOrder.mockResolvedValue({ ok: true, result: 'no_email' });
    expect((await call({ body: order({ note_attributes: [] }) })).body.result).toBe('no_email');
  });

  test('recordOrder throws -> 500 (Shopify retries), no email in the log', async () => {
    consultations.recordOrder.mockRejectedValue(new Error('db down for a@b.c'));
    const res = await call({ body: order({ note_attributes: [], email: 'a@b.c' }) });
    expect(res).toMatchObject({ statusCode: 500, body: { code: 'order_record_failed' } });
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('a@b.c');
  });

  test('an app booking order never reaches recordOrder', async () => {
    await call();
    expect(consultations.recordOrder).not.toHaveBeenCalled();
  });

  test('consultation variant missing -> 200 wrong_product', async () => {
    const res = await call({ body: order({ line_items: [{ variant_id: 999 }] }) });
    expect(res).toMatchObject({ statusCode: 200, body: { ok: true, result: 'wrong_product' } });
    expect(payments.recordPayment).not.toHaveBeenCalled();
  });

  test('variant ids are compared as strings (number or string both match)', async () => {
    expect((await call({ body: order({ line_items: [{ variant_id: 12345 }] }) })).body.result).toBe('confirmed');
    expect((await call({ body: order({ line_items: [{ variant_id: '12345' }] }) })).body.result).toBe('confirmed');
  });

  test.each(['confirmed', 'already_recorded', 'booking_not_found', 'needs_attention'])('recordPayment result %s -> 200 with that result', async result => {
    payments.recordPayment.mockResolvedValue({ ok: true, result });
    const res = await call();
    expect(res).toMatchObject({ statusCode: 200, body: { ok: true, result } });
  });

  test('recordPayment gets the booking id, order id as a string, numeric amount and currency', async () => {
    await call();
    expect(payments.recordPayment).toHaveBeenCalledWith({ bookingId: BOOKING, orderId: '777', amount: 150, currency: 'ILS' });
  });

  test('recordPayment throws -> 500 (Shopify retries), no email/payload in the log', async () => {
    payments.recordPayment.mockRejectedValue(new Error('db down for a@b.c'));
    const res = await call();
    expect(res).toMatchObject({ statusCode: 500, body: { code: 'payment_failed' } });
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('a@b.c');
  });

  test('syncCalendarEvents is scheduled AFTER the response, not before', async () => {
    await call();
    expect(immediateSpy).toHaveBeenCalledTimes(1);
    expect(payments.syncCalendarEvents).not.toHaveBeenCalled(); // only scheduled so far
    immediateSpy.mock.calls[0][0]();
    expect(payments.syncCalendarEvents).toHaveBeenCalledTimes(1);
  });

  test('a failing calendar sync is caught, never thrown', async () => {
    payments.syncCalendarEvents.mockRejectedValue(new Error('x'));
    await call();
    immediateSpy.mock.calls[0][0]();
    await new Promise(r => process.nextTick(r));
    expect(errorSpy).toHaveBeenCalled();
  });

  test('no calendar sync is scheduled for rejected or ignored deliveries', async () => {
    await call({ signature: 'bad' });
    await call({ topic: 'orders/create' });
    expect(immediateSpy).not.toHaveBeenCalled();
  });
});
