// "Book a consultation" at the end of every skin analysis (the Profile results screen), except the
// Shopify consultation flow. Plan: AI/plans/shopify-consultation-link.md (T8, decisions D2/D5).
//
// Signed in: the button shows when booking is on AND GET /api/bookings/mine says canBook
// (no upcoming in-app booking, no Shopify appointment that has not ended). A Shopify order
// WITHOUT a found appointment never hides it. Signed out: always shown, except when the app was
// opened from the Shopify link (?ref=consultation); the tap goes SignUp -> Booking.
import { test, expect } from './support/test.js';
import { BOOKING_UPCOMING } from './support/fixtures-data.js';
import { openProfileFromHome } from './support/nav.js';
import { walkQuizToLoading, expectProfileAfterQuiz } from './support/quiz.js';

const text = (page, value) => page.getByText(value, { exact: true });
const bookButton = page => page.getByTestId('profile-book-consultation');

// A consultation bought directly in Shopify, as GET /api/bookings/mine returns it.
const shopifyOrder = appointment => ({ orderName: '#1042', paidAt: '2026-09-28T09:00:00.000Z', appointment });
const MATCHED = { startsAt: '2026-10-04T07:00:00.000Z', endsAt: '2026-10-04T07:30:00.000Z', date: '2026-10-04', time: '10:00' };

// Opens Profile from Home and waits until the app has asked the server (so "hidden" is final).
async function openProfileAndWaitForBookingAnswer(page, mock, t) {
  await openProfileFromHome(page, t);
  await expect.poll(() => mock.callsTo('GET', '/api/bookings/mine').length).toBeGreaterThan(0);
}

test.describe('signed in', () => {
  test.use({ signedIn: true });

  test('nothing booked: the button shows (also when Profile is opened from Home) and opens Booking', async ({ page, t }) => {
    await openProfileFromHome(page, t);
    await expect(bookButton(page)).toHaveText(t('profile:bookCta'));
    await bookButton(page).click();
    await expect(page.getByTestId('booking-screen')).toBeVisible();
  });

  test('an upcoming in-app booking hides it', async ({ page, mock, t }) => {
    mock.booking({ upcoming: BOOKING_UPCOMING });
    await openProfileAndWaitForBookingAnswer(page, mock, t);
    await expect(bookButton(page)).toHaveCount(0);
  });

  test('a Shopify consultation with a found appointment hides it', async ({ page, mock, t }) => {
    mock.booking({ shopifyConsultation: shopifyOrder(MATCHED) });
    await openProfileAndWaitForBookingAnswer(page, mock, t);
    await expect(bookButton(page)).toHaveCount(0);
  });

  test('a Shopify order WITHOUT a found appointment never hides it', async ({ page, mock, t }) => {
    mock.booking({ shopifyConsultation: shopifyOrder(null) });
    await openProfileFromHome(page, t);
    await expect(bookButton(page)).toBeVisible();
  });

  test('booking switched off hides it', async ({ page, mock, t }) => {
    mock.booking({ enabled: false });
    await openProfileAndWaitForBookingAnswer(page, mock, t);
    await expect(bookButton(page)).toHaveCount(0);
  });

  test('a failing booking API hides it (no error on Profile)', async ({ page, mock, t }) => {
    mock.override('GET', '/api/bookings/mine', 500, { error: 'boom' });
    await openProfileAndWaitForBookingAnswer(page, mock, t);
    await expect(bookButton(page)).toHaveCount(0);
  });
});

test.describe('signed out (quiz-first)', () => {
  // A full quiz walk has timed screens and takes 25-40 s (same allowance as quiz-onboarding.spec.js).
  test.setTimeout(180_000);

  test('after the quiz the button shows; it goes SignUp -> account created -> Booking', async ({ page, mock, t }) => {
    await page.goto('/');
    await walkQuizToLoading(page, t);
    await expectProfileAfterQuiz(page, t);
    // Signed out the app cannot ask the server, so nothing booking-related was called yet.
    expect(mock.callsTo('GET', '/api/bookings/mine')).toHaveLength(0);

    await bookButton(page).click();
    await page.getByPlaceholder(t('auth:signup.emailPlaceholder')).fill('dana@example.test');
    await page.getByPlaceholder(t('auth:signup.passwordPlaceholder')).fill('password123');
    await text(page, t('auth:signup.ctaAfterQuiz')).click();

    // The Booking screen, not the onboarding (SkinTiming); the analysis is still saved once.
    await expect(page.getByTestId('booking-screen')).toBeVisible();
    await expect(text(page, t('onboarding:timing.headline'))).toHaveCount(0);
    await expect.poll(() => mock.callsTo('POST', '/api/analysis').length).toBe(1);
  });

  test('booking switched off: after sign-up the normal onboarding opens instead', async ({ page, mock, t }) => {
    mock.booking({ enabled: false });
    await page.goto('/');
    await walkQuizToLoading(page, t);
    await expectProfileAfterQuiz(page, t);
    await bookButton(page).click();
    await page.getByPlaceholder(t('auth:signup.emailPlaceholder')).fill('dana@example.test');
    await page.getByPlaceholder(t('auth:signup.passwordPlaceholder')).fill('password123');
    await text(page, t('auth:signup.ctaAfterQuiz')).click();
    await expect(text(page, t('onboarding:timing.headline'))).toBeVisible();
  });

  test('opened from the Shopify link (?ref=consultation): no booking button after the quiz', async ({ page, t }) => {
    await page.goto('/?ref=consultation');
    await walkQuizToLoading(page, t, { startCta: 'onboarding:welcome.consultation.cta' });
    await expectProfileAfterQuiz(page, t);
    await expect(bookButton(page)).toHaveCount(0);
  });
});
