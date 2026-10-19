// Baseline tests for Home, Profile (opened from Home) and the product camera, signed in with the
// fixture analysis (Dana, "Barrier Healing Era", SR product routine, one AM step already ticked).
//
// These lock in what the app does TODAY, plus (TEST-FIRST: written before the feature exists, against
// AI/plans/catalogue-recs-and-ai-admin-contract.md sections 3 and 6) the Home routine step photos, the
// Home "My products" card and the Profile link to the new My products screen. The product audit / SR
// ritual / shelf / market picks that used to live on Profile now live on My products: their tests moved
// to e2e/my-products.spec.js and here Profile is asserted to NO LONGER contain them. Notes for a junior developer:
//   - The app has no URLs: "navigation" is an in-memory stack, so we click through the UI.
//   - The browser clock starts at 2026-09-29 09:00 UTC (morning) and keeps running, so Home says "Good morning",
//     and the user's skincareTiming is 'morning', so Home opens on the Morning (AM) tab.
//   - Only the TOP screen of the stack is mounted, so a text that exists on two screens is never
//     ambiguous. Inside one screen, fixture strings are matched with exact: true, because
//     Playwright's default text match is a case-insensitive substring.
import { test, expect } from './support/test.js';
import { TODAY, ANALYSIS, PID } from './support/fixtures-data.js';
import { openMenu, tapMenuItem, backButton, openHome } from './support/nav.js';

test.use({ signedIn: true });

// The fixture's SR routine, as Home lists it (see fixtures-data.js srProducts).
// Derived from the exported ANALYSIS fixture so the names cannot drift from it: a matched product
// shows its product name, an unmatched slot shows its category name.
const stepName = (s) => (s.sr_product_id ? s.sr_product_name : s.routine_category);
const AM_STEPS = ANALYSIS.srProducts.am.map(stepName);
const PM_STEPS = ANALYSIS.srProducts.pm.map(stepName);
const NO_MATCH_NOTE = ANALYSIS.srProducts.am.find((s) => s.no_match_note).no_match_note;

// The "Messages" button on Home, found by its accessibility label.
const messagesButton = (page, t, count) =>
  // exact: true, because the plain label "Messages" is a substring of "Messages, 1 unread".
  page.getByLabel(count ? t('home:messages.unread', { count }) : t('home:messages.label'), { exact: true });

// Home -> "View my full analysis" -> Profile. nav.js's openProfileFromHome waits for the old Product
// Audit title, which is leaving Profile, so this local helper waits for the Profile title instead
// (that title exists before and after the change).
async function openProfile(page, t) {
  await openHome(page, t);
  await page.getByText(t('home:viewAnalysis.title')).click();
  await expect(page.getByText(t('profile:analysisTitle'))).toBeVisible();
}

// "1/3 steps complete" style progress line on Home.
const progress = (t, done) => t('home:progress.steps', { count: 3, done, total: 3 });

test.describe('Home', () => {
  test('shows the morning greeting, the era name and opens on the Morning tab', async ({ page, t }) => {
    await openHome(page, t);
    await expect(page.getByText('Barrier Healing Era')).toBeVisible();
    // skincareTiming 'morning' -> the AM steps are listed, the PM-only step is not.
    for (const name of AM_STEPS) await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.getByText('Hydra Calm Serum', { exact: true })).toHaveCount(0);
    // Product steps show their routine slot as a caption.
    await expect(page.getByText('Cleanser', { exact: true })).toBeVisible();
    // The fixture affirmation is shown in quotes.
    await expect(page.getByText('I give my skin permission to heal at its own pace.')).toBeVisible();
  });

  test('AM / PM tabs switch the steps shown', async ({ page, t }) => {
    await openHome(page, t);
    await page.getByText(t('home:tabs.pm'), { exact: true }).click();
    // PM-only step appears, AM-only step (no matched product -> the slot name) disappears.
    await expect(page.getByText('Hydra Calm Serum', { exact: true })).toBeVisible();
    await expect(page.getByText('Sunscreen', { exact: true })).toHaveCount(0);
    for (const name of PM_STEPS) await expect(page.getByText(name, { exact: true })).toBeVisible();
    // Back to Morning.
    await page.getByText(t('home:tabs.am'), { exact: true }).click();
    await expect(page.getByText('Sunscreen', { exact: true })).toBeVisible();
    await expect(page.getByText('Hydra Calm Serum', { exact: true })).toHaveCount(0);
  });

  test('a step with no matched product shows the note from the analysis', async ({ page, t }) => {
    await openHome(page, t);
    await expect(page.getByText(NO_MATCH_NOTE)).toBeVisible();
  });

  test('restores the pre-ticked AM step from the server and asks for today', async ({ page, t, mock }) => {
    await openHome(page, t);
    // Fixture ticks: am [0] -> 1 of 3 steps complete (shown once the server copy arrives).
    await expect(page.getByText(progress(t, 1))).toBeVisible();
    // Exactly one step shows the check mark instead of its number.
    await expect(page.getByText(String.fromCharCode(0x2713), { exact: true })).toHaveCount(1);
    expect(mock.lastCall('GET', '/api/routine-progress').query).toEqual({ date: TODAY });
  });

  test('ticking and unticking a step sends PUT /api/routine-progress with the ticked indices', async ({ page, t, mock }) => {
    await openHome(page, t);
    await expect(page.getByText(progress(t, 1))).toBeVisible();

    // Tick step 2 (index 1): the body carries today's date, the routine key and BOTH lists.
    await page.getByText('Barrier Repair Cream', { exact: true }).click();
    await expect(page.getByText(progress(t, 2))).toBeVisible();
    await expect.poll(() => mock.callsTo('PUT', '/api/routine-progress').length).toBe(1);
    const first = mock.lastCall('PUT', '/api/routine-progress');
    expect(first.authed).toBe(true);
    expect(first.body).toEqual({ date: TODAY, routineKey: expect.stringMatching(/^[0-9a-f]+$/), am: [0, 1], pm: [] });

    // Untick step 1 (index 0): only index 1 stays ticked; the routine key is unchanged.
    await page.getByText('Gentle Gel Cleanser', { exact: true }).click();
    await expect(page.getByText(progress(t, 1))).toBeVisible();
    await expect.poll(() => mock.callsTo('PUT', '/api/routine-progress').length).toBe(2);
    const second = mock.lastCall('PUT', '/api/routine-progress');
    expect(second.body).toEqual({ date: TODAY, routineKey: first.body.routineKey, am: [1], pm: [] });
  });

  test('ticking a PM step keeps the AM ticks and sends them in the pm list', async ({ page, t, mock }) => {
    await openHome(page, t);
    await expect(page.getByText(progress(t, 1))).toBeVisible();
    await page.getByText(t('home:tabs.pm'), { exact: true }).click();
    // PM has nothing ticked yet.
    await expect(page.getByText(progress(t, 0))).toBeVisible();
    await page.getByText('Hydra Calm Serum', { exact: true }).click();
    await expect.poll(() => mock.callsTo('PUT', '/api/routine-progress').length).toBe(1);
    expect(mock.lastCall('PUT', '/api/routine-progress').body).toMatchObject({ date: TODAY, am: [0], pm: [1] });
  });

  test('ticking every step shows the "ritual complete" state', async ({ page, t, mock }) => {
    await openHome(page, t);
    await expect(page.getByText(progress(t, 1))).toBeVisible();
    await page.getByText('Barrier Repair Cream', { exact: true }).click();
    await page.getByText('Sunscreen', { exact: true }).click();
    await expect(page.getByText(t('home:progress.ritualComplete'))).toBeVisible();
    await expect(page.getByText(t('home:done.title'))).toBeVisible();
    await expect.poll(() => mock.callsTo('PUT', '/api/routine-progress').length).toBe(2);
    expect(mock.lastCall('PUT', '/api/routine-progress').body.am).toEqual([0, 1, 2]);
  });

  test('check-in sheet: Save does nothing until a mood is picked, then posts the mood', async ({ page, t, mock }) => {
    await openHome(page, t);
    await page.getByText(t('home:checkIn.title')).click();
    await expect(page.getByText(t('home:checkIn.question'))).toBeVisible();

    // No mood selected: the Save button is disabled (a disabled button cannot be clicked, so we
    // assert its state), nothing is sent and the sheet stays open.
    // (the Save Pressable has no button role, so we look for the element flagged aria-disabled).
    await expect(page.locator('[aria-disabled="true"]', { hasText: t('home:checkIn.save') })).toHaveCount(1);
    expect(mock.callsTo('POST', '/api/checkins')).toHaveLength(0);

    // Pick "Calm", save: the STORED value is the English label ("Calm"), not the translation key.
    await page.getByText(t('home:moods.calm'), { exact: true }).click();
    await page.getByText(t('home:checkIn.save')).click();
    await expect.poll(() => mock.callsTo('POST', '/api/checkins').length).toBe(1);
    expect(mock.lastCall('POST', '/api/checkins').body).toEqual({ mood: 'Calm' });

    // The sheet closes and the check-in card is replaced by the "complete" message.
    await expect(page.getByText(t('home:checkIn.question'))).toHaveCount(0);
    await expect(page.getByText(t('home:checkIn.complete', { mood: t('home:moods.calm') }))).toBeVisible();
    await expect(page.getByText(t('home:checkIn.title'))).toHaveCount(0);
  });

  test('check-in sheet: the close button dismisses it without sending anything', async ({ page, t, mock }) => {
    await openHome(page, t);
    await page.getByText(t('home:checkIn.title')).click();
    // exact: the card title "Daily skin check-in" also contains "skin check-in".
    await expect(page.getByText(t('home:checkIn.modalTitle'), { exact: true })).toBeVisible();
    await page.getByText(String.fromCharCode(0x2715), { exact: true }).click();
    await expect(page.getByText(t('home:checkIn.modalTitle'), { exact: true })).toHaveCount(0);
    // The check-in card is still offered.
    await expect(page.getByText(t('home:checkIn.title'))).toBeVisible();
    expect(mock.callsTo('POST', '/api/checkins')).toHaveLength(0);
  });

  test('unread badge shows the fixture count (1) with its accessible label', async ({ page, t, mock }) => {
    await openHome(page, t);
    const button = messagesButton(page, t, 1);
    await expect(button).toBeVisible();
    await expect(button.getByText('1', { exact: true })).toBeVisible();
    expect(mock.callsTo('GET', '/api/messages/unread-count').length).toBeGreaterThan(0);
  });

  test('unread badge follows mock.set({ unread }): 3, 12 shows "9+", 0 hides it', async ({ page, t, mock }) => {
    mock.set({ unread: 3 });
    await openHome(page, t);
    await expect(messagesButton(page, t, 3).getByText('3', { exact: true })).toBeVisible();

    // More than 9 -> "9+" (the accessible label still carries the real number).
    mock.set({ unread: 12 });
    await page.reload();
    await expect(messagesButton(page, t, 12).getByText('9+', { exact: true })).toBeVisible();

    // Zero -> plain "Messages" label and no badge number.
    mock.set({ unread: 0 });
    await page.reload();
    await expect(messagesButton(page, t, 0)).toBeVisible();
    await expect(messagesButton(page, t, 0).getByText(/^\d/)).toHaveCount(0);
  });
});

// Routine step photos (contract section 3, "Home steps"). A matched step (its sr_product_id is a
// 24-hex catalogue id) shows a thumbnail `routine-step-photo-<productId>`; an unmatched step shows
// `routine-step-photo-placeholder`. The catalogue answer comes from the mock (fixtures CATALOGUE).
test.describe('Home routine step photos', () => {
  test('AM: matched steps show their product thumbnail, the unmatched step a placeholder', async ({ page, t, mock }) => {
    await openHome(page, t);
    await expect(page.getByTestId(`routine-step-photo-${PID.cleanser}`)).toBeVisible();
    await expect(page.getByTestId(`routine-step-photo-${PID.moisturizer}`)).toBeVisible();
    // Step 3 (Sunscreen) has no product: exactly one placeholder on the AM list.
    await expect(page.getByTestId('routine-step-photo-placeholder')).toHaveCount(1);
    // The thumbnails come from an authed catalogue request carrying the matched ids.
    await expect.poll(() => mock.callsTo('GET', '/api/catalogue/products').length).toBeGreaterThan(0);
    const call = mock.callsTo('GET', '/api/catalogue/products')[0];
    expect(call.authed).toBe(true);
    expect(call.query.ids.split(',')).toEqual(expect.arrayContaining([PID.cleanser, PID.moisturizer]));
  });

  test('PM tab: the matched steps keep their thumbnails', async ({ page, t }) => {
    await openHome(page, t);
    await page.getByText(t('home:tabs.pm'), { exact: true }).click();
    await expect(page.getByTestId(`routine-step-photo-${PID.cleanser}`)).toBeVisible();
    await expect(page.getByTestId(`routine-step-photo-${PID.moisturizer}`)).toBeVisible();
    // The PM serum step has a catalogue product but hasPhoto=false (fixtures), and the contract says
    // a thumbnail needs hasPhoto, so exactly that one step shows the placeholder.
    await expect(page.getByTestId(`routine-step-photo-${PID.serum}`)).toHaveCount(0);
    await expect(page.getByTestId('routine-step-photo-placeholder')).toHaveCount(1);
  });

  test('a step with an old non-catalogue id (sr-clean) shows the placeholder and asks for no photo', async ({ page, t, mock }) => {
    // An analysis saved before catalogue ids: ids that are not 24-hex must never reach the API.
    const old = structuredClone(ANALYSIS);
    old.srProducts.am[0].sr_product_id = 'sr-clean';
    mock.set({ analysis: old });
    await openHome(page, t);
    await expect(page.getByText('Gentle Gel Cleanser', { exact: true })).toBeVisible();
    await expect(page.getByTestId(`routine-step-photo-${PID.cleanser}`)).toHaveCount(0);
    // Old step + unmatched sunscreen = 2 placeholders (the moisturizer step keeps its photo).
    await expect(page.getByTestId('routine-step-photo-placeholder')).toHaveCount(2);
    for (const c of mock.callsTo('GET', '/api/catalogue/products')) {
      expect(c.query.ids.split(',')).not.toContain('sr-clean');
    }
  });
});

test.describe('Home "My products" card', () => {
  test('shows the title and subtitle and opens the My products screen', async ({ page, t }) => {
    await openHome(page, t);
    const card = page.getByTestId('home-my-products-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(t('home:myProducts.title'));
    await expect(card).toContainText(t('home:myProducts.subtitle'));
    await card.click();
    await expect(page.getByTestId('myproducts-hero')).toBeVisible();
    // Home is gone (only the top screen is mounted).
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
  });

  test('"View my full analysis" has the new subtitle (the product audit moved out of Profile)', async ({ page, t }) => {
    await openHome(page, t);
    // Literal on purpose: this is the contract text, and the locale file still holds the old one
    // until the feature lands (t() would just echo the old text and the test would pass too early).
    await expect(page.getByText('Your skin analysis and score', { exact: true })).toBeVisible();
    await expect(page.getByText('Your skin analysis, product audit and product routine')).toHaveCount(0);
  });
});

test.describe('Home entry points', () => {
  test('Messages button opens the Messages screen; returning Home refreshes the unread badge', async ({ page, t, mock }) => {
    await openHome(page, t);
    await messagesButton(page, t, 1).click();
    await expect(page.getByText(t('messages:subtitle'))).toBeVisible();
    // The fixture thread is shown.
    await expect(page.getByText('Hi Dana, welcome! Tell us if anything in your routine feels irritating.')).toBeVisible();

    // Opening the thread marks it read; wait for that call so it cannot overwrite our change below.
    await expect.poll(() => mock.callsTo('POST', '/api/messages/read').length).toBeGreaterThan(0);
    // While the user is away, 2 new messages arrive on the server.
    mock.set({ unread: 2 });
    const before = mock.callsTo('GET', '/api/messages/unread-count').length;

    // Back to Home through the side menu ("My routine" does goBack). Home re-mounts and asks
    // again, so the badge shows 2 (Messages screen had zeroed it locally, so 2 proves a refetch).
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:myRoutine');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(messagesButton(page, t, 2)).toBeVisible();
    await expect.poll(() => mock.callsTo('GET', '/api/messages/unread-count').length).toBeGreaterThan(before);
  });

  test('"View my full analysis" opens Profile', async ({ page, t }) => {
    await openProfile(page, t);
    await expect(page.getByText(t('profile:analysisTitle'))).toBeVisible();
    // Opened from Home: Profile has no Back control (its CTA / menu lead back).
    await expect(backButton(page, t)).toHaveCount(0);
    // Home is gone (only the top screen is mounted).
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
  });

  test('side menu "My skin profile" opens Profile (fromHome) with its menu button', async ({ page, t }) => {
    await openHome(page, t);
    // "My skin profile" lives in the side menu, not as a button on Home.
    await openMenu(page, t);
    await page.getByRole('button', { name: t('menu:mySkinProfile') }).click();
    await expect(page.getByText(t('profile:analysisTitle'))).toBeVisible();
    await expect(page.getByRole('button', { name: t('menu:open') })).toBeVisible();
    await expect(backButton(page, t)).toHaveCount(0);
  });

  test('"Log your products" card opens the product camera', async ({ page, t }) => {
    await openHome(page, t);
    await page.getByText(t('home:logProducts.title')).click();
    await expect(page.getByText(t('camera:title'))).toBeVisible();
    await expect(page.getByText(t('camera:takePhoto'))).toBeVisible();
    await expect(page.getByText(t('camera:chooseLibrary'))).toBeVisible();
  });

  test('side menu "Log my products" opens the product camera', async ({ page, t }) => {
    await openHome(page, t);
    await openMenu(page, t);
    await page.getByRole('button', { name: t('menu:logProducts') }).click();
    await expect(page.getByText(t('camera:title'))).toBeVisible();
  });

  test('Home itself has no Back control', async ({ page, t }) => {
    await openHome(page, t);
    await expect(backButton(page, t)).toHaveCount(0);
  });
});

test.describe('Profile (opened from Home)', () => {
  test('score section: eyebrow with the day number, title, "Start here" and the four signals', async ({ page, t }) => {
    await openProfile(page, t);
    // First reading 2026-09-15, "now" 2026-09-29 -> Day 15.
    await expect(page.getByText(t('score:eyebrow', { day: 15 }))).toBeVisible();
    await expect(page.getByText(t('score:title'))).toBeVisible();
    await expect(page.getByText(t('score:startHere'), { exact: true })).toBeVisible();
    await expect(page.getByText('Add a ceramide moisturizer at night')).toBeVisible();
    for (const key of ['barrier', 'clarity', 'tone', 'resilience']) {
      await expect(page.getByText(t(`score:signals.${key}`), { exact: true })).toBeVisible();
    }
  });

  test('a signal card expands when tapped (reading is ready)', async ({ page, t }) => {
    await openProfile(page, t);
    const card = page.getByRole('button', { name: new RegExp(t('score:signals.barrier')) });
    await expect(card).toHaveAttribute('aria-expanded', 'false');
    await card.click();
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Moisture is low and your skin is losing water faster than it can hold it.')).toBeVisible();
  });

  test('era, analysis text and key insights are shown', async ({ page, t }) => {
    await openProfile(page, t);
    await expect(page.getByText(t('profile:eraEyebrow'))).toBeVisible();
    await expect(page.getByText('Barrier Healing Era')).toBeVisible();
    await expect(page.getByText(t('profile:insightsTitle'))).toBeVisible();
    await expect(page.getByText('Barrier first: Calm the barrier before adding any strong actives.')).toBeVisible();
  });

  test('product sections moved out: no audit, SR ritual, shelf or market picks, but a link to My products', async ({ page, t, mock }) => {
    await openProfile(page, t);
    // Those sections live on My products now (see e2e/my-products.spec.js).
    await expect(page.getByText(t('profile:audit.title'))).toHaveCount(0);
    await expect(page.getByText(t('profile:sr.title'))).toHaveCount(0);
    await expect(page.getByText(t('profile:shelf.title'))).toHaveCount(0);
    await expect(page.getByText(NO_MATCH_NOTE)).toHaveCount(0);
    // Market picks are no longer requested by Profile either.
    expect(mock.callsTo('POST', '/api/ai/product-recommendations')).toHaveLength(0);
    // The link replaces them.
    await expect(page.getByTestId('profile-my-products-link')).toBeVisible();
    await expect(page.getByTestId('profile-my-products-link')).toContainText(t('profile:myProductsLink'));
  });

  test('the "My products" link opens the My products screen', async ({ page, t }) => {
    await openProfile(page, t);
    await page.getByTestId('profile-my-products-link').click();
    await expect(page.getByTestId('myproducts-hero')).toBeVisible();
    // Profile is gone (only the top screen is mounted).
    await expect(page.getByText(t('profile:analysisTitle'))).toHaveCount(0);
  });

  test('the CTA goes back to Home (goBack) and Home is fully usable again', async ({ page, t }) => {
    await openProfile(page, t);
    await page.getByText(t('profile:cta')).click();
    // Back on Home; Profile is no longer mounted.
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.getByText(t('profile:analysisTitle'))).toHaveCount(0);
    // One Home only: a single greeting, and Home works (tabs still switch).
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(1);
    await expect(backButton(page, t)).toHaveCount(0);
    await page.getByText(t('home:tabs.pm'), { exact: true }).click();
    await expect(page.getByText('Hydra Calm Serum', { exact: true })).toBeVisible();
    // NOTE: the stack depth itself (no second Home pushed) is not observable on web: the app has
    // no URL/history and Home has no Back button. The code uses goBack(), not navigate('Home').
  });
});

test.describe('ProductCamera', () => {
  test('Back returns to Home', async ({ page, t }) => {
    await openHome(page, t);
    await page.getByText(t('home:logProducts.title')).click();
    await expect(page.getByText(t('camera:title'))).toBeVisible();
    await backButton(page, t).click();
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.getByText(t('camera:title'))).toHaveCount(0);
  });

  test('opened from the side menu, Back also returns to Home', async ({ page, t }) => {
    await openHome(page, t);
    await openMenu(page, t);
    await page.getByRole('button', { name: t('menu:logProducts') }).click();
    await expect(page.getByText(t('camera:title'))).toBeVisible();
    await backButton(page, t).click();
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.getByText(t('camera:title'))).toHaveCount(0);
  });
});
