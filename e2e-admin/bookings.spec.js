// Admin bookings e2e specs, written TEST-FIRST against AI/plans/in-app-booking-contract.md
// (section 7 Admin, section 6 routes, section 10 "Playwright admin"). The booking code did not
// exist when this was written, so these specs are RED until the build lands.
//
// They run against the REAL server with an IN-MEMORY MongoDB (see support/startServer.js, which
// turns booking on with the FAKE calendar: busy 12:00-13:00 clinic time every day). Nothing
// here touches a real database or the real Google calendar.
//
// Specs share one DB and run serially in file order; later specs use data made by earlier ones.
// Slots depend on the real "now", so we never hard-code a date: we pick a slot from the API.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from './support/session.js';
import { JWT_SECRET } from './support/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Use the SERVER's own node_modules (mongoose, jsonwebtoken); e2e-admin has none.
const serverRequire = createRequire(path.resolve(here, '../server/package.json'));

test.describe.configure({ mode: 'serial' });

// Data shared between the serial specs.
const state = {
  userA: null,      // { id, email, token }
  userB: null,
  slot: null,       // the slot userA books: { startsAt, endsAt, date, time }
  bookingId: null,
};

const notice = page => page.locator('.notice');

// Inserts a User into the IN-MEMORY DB and returns it with a user JWT signed like
// server/routes/auth.js does (payload { id, email }, the test JWT_SECRET).
async function createUser(email, firstName) {
  const { uri } = JSON.parse(readFileSync(path.join(here, '.tmp', 'db.json'), 'utf8'));
  // Safety guard: only ever the local memory server.
  expect(uri).toMatch(/^mongodb:\/\/(127\.0\.0\.1|localhost)/);
  const mongoose = serverRequire('mongoose');
  const jwt = serverRequire('jsonwebtoken');
  const User = serverRequire('./models/User.js');
  await mongoose.connect(uri);
  try {
    const user = await User.create({ email, firstName, passwordHash: 'not-a-real-hash' });
    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    return { id: String(user._id), email: user.email, token };
  } finally {
    await mongoose.disconnect();
  }
}

const bearer = user => ({ Authorization: `Bearer ${user.token}` });

// Books `startsAt` through the real API as `user`.
const book = (request, user, startsAt) =>
  request.post('/api/bookings', { headers: bearer(user), data: { startsAt } });

// The row of the booking in the list (id comes from the POST response).
const row = (page, id) => page.locator(`tr[data-booking-id="${id}"]`);

test.describe('bookings', () => {
  // 1. Signed out
  test('1. signed-out booking pages redirect to login', async ({ page }) => {
    for (const url of ['/admin/bookings', '/admin/booking-settings']) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/admin\/login/);
    }
  });

  // 2. Nav
  test('2. nav has a Bookings link that opens the list', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin');
    const link = page.getByRole('link', { name: 'Bookings', exact: true });
    await expect(link).toHaveAttribute('href', '/admin/bookings');
    await link.click();
    await expect(page).toHaveURL(/\/admin\/bookings$/);
    await expect(page.getByRole('heading', { name: 'Bookings', exact: true })).toBeVisible();
    // Nothing booked yet.
    await expect(page.locator('p.muted', { hasText: 'No bookings.' })).toBeVisible();
  });

  // 3. API: unauthenticated config
  test('3. /api/bookings/config without a token is 401', async ({ request }) => {
    const res = await request.get('/api/bookings/config');
    expect(res.status()).toBe(401);
    expect((await res.json()).code).toBe('auth_required');
  });

  // 4. Setup users + book through the real API
  test('4. API: slots, booking 201, same user 409 limit_reached, same slot 409 slot_taken', async ({ request }) => {
    state.userA = await createUser('e2e-booker-a@example.test', 'Alma');
    state.userB = await createUser('e2e-booker-b@example.test', 'Ben');

    // Public config for a signed-in user.
    const cfg = await request.get('/api/bookings/config', { headers: bearer(state.userA) });
    expect(cfg.status()).toBe(200);
    expect((await cfg.json()).enabled).toBe(true);

    // Pick a slot from the API (never a hard-coded date). The mock calendar is busy 12:00-13:00
    // local every day, so no returned slot may start at 12:00 or 12:30.
    const slotsRes = await request.get('/api/bookings/slots', { headers: bearer(state.userA) });
    expect(slotsRes.status()).toBe(200);
    const { timeZone, slots } = await slotsRes.json();
    expect(timeZone).toBe('Asia/Jerusalem');
    expect(slots.length).toBeGreaterThan(1);
    expect(slots.some(s => s.time === '12:00' || s.time === '12:30')).toBe(false);
    state.slot = slots[0];

    // First booking works.
    const ok = await book(request, state.userA, state.slot.startsAt);
    expect(ok.status()).toBe(201);
    const body = await ok.json();
    expect(body.booking.status).toBe('confirmed');
    expect(body.booking.date).toBe(state.slot.date);
    expect(body.booking.time).toBe(state.slot.time);
    state.bookingId = body.booking.id;

    // Same user again (a different slot): one upcoming booking at a time.
    const again = await book(request, state.userA, slots[1].startsAt);
    expect(again.status()).toBe(409);
    expect((await again.json()).code).toBe('limit_reached');

    // Another user, the slot that is already taken.
    const taken = await book(request, state.userB, state.slot.startsAt);
    expect(taken.status()).toBe(409);
    expect((await taken.json()).code).toBe('slot_taken');

    // The taken slot is gone from the list.
    const after = await request.get('/api/bookings/slots', { headers: bearer(state.userB) });
    const left = (await after.json()).slots;
    expect(left.some(s => s.startsAt === state.slot.startsAt)).toBe(false);
  });

  // 5. Upcoming list
  test('5. Upcoming tab shows the row with the client email link', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/bookings');
    const r = row(page, state.bookingId);
    await expect(r).toHaveCount(1);
    await expect(r.locator('td.when')).toHaveText(`${state.slot.date} ${state.slot.time}`);
    const client = r.getByRole('link', { name: state.userA.email });
    await expect(client).toHaveAttribute('href', `/admin/users/${state.userA.id}`);
    await expect(r.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
    // The other tabs do not list it.
    await page.getByRole('link', { name: 'Cancelled', exact: true }).click();
    await expect(page).toHaveURL(/tab=cancelled/);
    await expect(row(page, state.bookingId)).toHaveCount(0);
  });

  // 6. User page card
  test('6. the user page has a Bookings card with the booking', async ({ page, context }) => {
    await signIn(context);
    await page.goto(`/admin/users/${state.userA.id}`);
    const card = page.locator('#bookings');
    await expect(card.getByRole('heading', { name: 'Bookings' })).toBeVisible();
    const item = card.locator(`li[data-booking-id="${state.bookingId}"]`);
    await expect(item).toContainText(`${state.slot.date} ${state.slot.time}`);
    await expect(item).toContainText('confirmed');
    // A user without bookings says so.
    await page.goto(`/admin/users/${state.userB.id}`);
    await expect(page.locator('#bookings')).toContainText('No bookings.');
  });

  // 7. CSRF
  test('7. cancel without or with a wrong _csrf gets 403 and keeps the booking', async ({ page, context }) => {
    await signIn(context);
    for (const extra of [{}, { _csrf: 'wrong-token' }]) {
      const res = await page.request.post(`/admin/bookings/${state.bookingId}/cancel`, { form: extra, maxRedirects: 0 });
      expect(res.status()).toBe(403);
    }
    await page.goto('/admin/bookings');
    await expect(row(page, state.bookingId)).toHaveCount(1);
  });

  // 8. Cancel through the form
  test('8. cancel via the form: notice, row moves to Cancelled, slot is bookable again', async ({ page, context, request }) => {
    await signIn(context);
    // The cancel form asks "are you sure" through a confirm dialog; accept it.
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/admin/bookings');
    await row(page, state.bookingId).getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page).toHaveURL(/\/admin\/bookings/);
    await expect(notice(page)).toHaveText('Booking cancelled and removed from the calendar.');
    await expect(row(page, state.bookingId)).toHaveCount(0);

    // Now in the Cancelled tab, with the client still shown.
    await page.getByRole('link', { name: 'Cancelled', exact: true }).click();
    const r = row(page, state.bookingId);
    await expect(r).toHaveCount(1);
    await expect(r).toContainText(state.userA.email);

    // The user's own list no longer shows it, and the slot can be booked again (by user B).
    const mine = await request.get('/api/bookings/mine', { headers: bearer(state.userA) });
    expect((await mine.json()).upcoming).toBeNull();
    const rebook = await book(request, state.userB, state.slot.startsAt);
    expect(rebook.status()).toBe(201);
  });

  // 9. Settings page defaults
  test('9. settings page shows the defaults', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/bookings');
    await page.getByRole('link', { name: 'Booking settings' }).click();
    await expect(page).toHaveURL(/\/admin\/booking-settings$/);
    await expect(page.getByRole('heading', { name: 'Booking settings' })).toBeVisible();
    await expect(page.getByText('Time zone: Asia/Jerusalem')).toBeVisible();

    await expect(page.getByLabel('Booking enabled')).toBeChecked();
    await expect(page.getByLabel('Slot length (minutes)')).toHaveValue('30');
    await expect(page.getByLabel('Buffer between consultations (minutes)')).toHaveValue('0');
    await expect(page.getByLabel('Minimum notice (hours)')).toHaveValue('12');
    await expect(page.getByLabel('Booking window (days)')).toHaveValue('30');
    // Sunday-Thursday open 10:00-18:00; Friday and Saturday closed.
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const [d, name] of days.entries()) {
      const enabled = page.locator(`input[name="day${d}_enabled"]`);
      if (d <= 4) {
        await expect(enabled, `${name} should be open`).toBeChecked();
        await expect(page.locator(`input[name="day${d}_open"]`)).toHaveValue('10:00');
        await expect(page.locator(`input[name="day${d}_close"]`)).toHaveValue('18:00');
      } else {
        await expect(enabled, `${name} should be closed`).not.toBeChecked();
      }
    }
  });

  // 10. Save a change
  test('10. saving leadHours 24 shows the saved notice and persists', async ({ page, context, request }) => {
    await signIn(context);
    await page.goto('/admin/booking-settings');
    await page.getByLabel('Minimum notice (hours)').fill('24');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page).toHaveURL(/\/admin\/booking-settings/);
    await expect(notice(page)).toHaveText('Booking settings saved.');
    await page.reload();
    await expect(page.getByLabel('Minimum notice (hours)')).toHaveValue('24');
    // The app-facing config reads the same value.
    const cfg = await request.get('/api/bookings/config', { headers: bearer(state.userA) });
    expect((await cfg.json()).leadHours).toBe(24);
    // Saving again without changes says nothing changed.
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(notice(page)).toHaveText('Nothing changed.');
  });

  // 11. Invalid time
  test('11. an invalid time gives 400, the invalid notice and keeps the typed values', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/booking-settings');
    // A time input cannot hold "25:99", so turn it into a plain text box first.
    await page.locator('input[name="day0_open"]').evaluate(el => { el.type = 'text'; });
    await page.locator('input[name="day0_open"]').fill('25:99');
    await page.getByLabel('Buffer between consultations (minutes)').fill('15');
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().endsWith('/admin/booking-settings') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save settings' }).click(),
    ]);
    expect(response.status()).toBe(400);
    await expect(notice(page)).toHaveText(
      'Please check the settings: times must be HH:MM, closing after opening, and the numbers within range.'
    );
    // The form is shown again with what was typed.
    await expect(page.locator('input[name="day0_open"]')).toHaveValue('25:99');
    await expect(page.getByLabel('Buffer between consultations (minutes)')).toHaveValue('15');

    // Nothing was saved: a fresh load still has the old buffer.
    await page.goto('/admin/booking-settings');
    await expect(page.getByLabel('Buffer between consultations (minutes)')).toHaveValue('0');
  });

  // 12. Audit
  test('12. audit log shows booking cancelled and booking settings updated', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/audit');
    await expect(page.getByText('booking cancelled').first()).toBeVisible();
    await expect(page.getByText('booking settings updated').first()).toBeVisible();
    // The cancel entry links to the client (user target).
    await expect(page.locator(`a[href="/admin/users/${state.userA.id}"]`).first()).toBeVisible();
  });
});
