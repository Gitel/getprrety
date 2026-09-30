// Baseline tests (T-B5): the Messages and Settings screens, signed in.
// They lock in what the app does TODAY, before the swipe-back feature changes navigation.
//
// How the screens are reached (there are no URLs, the app keeps its own screen stack):
//   Messages  = the message button on Home (its accessible name is the "Messages" label)
//   Settings  = hamburger button -> side menu -> "Settings"
import { test, expect } from './support/test.js';
import { openMessages, openSettings, openMenu, tapMenuItem, backButton } from './support/nav.js';
import { edgeSwipe } from './support/touch.js';

test.use({ signedIn: true });

// The Send button is a react-native-web Pressable: a div that carries aria-disabled="true" while
// disabled (it has no button role and no native disabled attribute), so we look for that attribute.
async function expectSendDisabled(page, t, disabled) {
  const disabledSend = page.locator('[aria-disabled="true"]').filter({ hasText: t('messages:send') });
  await expect(disabledSend).toHaveCount(disabled ? 1 : 0);
}

test.describe('Messages', () => {
  test('shows the title, subtitle and the fixture thread with sender lines', async ({ page, t }) => {
    await openMessages(page, t);
    await expect(page.getByText(t('messages:subtitle'))).toBeVisible();
    // All three fixture bodies are shown, oldest first.
    await expect(page.getByText('Hi Dana, welcome!')).toBeVisible();
    await expect(page.getByText('Thank you! The new cleanser feels much gentler.')).toBeVisible();
    await expect(page.getByText('Great to hear. Your consultation is confirmed for next week.')).toBeVisible();
    // Sender line = "<who> - <time>". Two messages come from the clinic, one from the user.
    await expect(page.getByText(new RegExp(`^${t('messages:clinic')} \\u00B7`))).toHaveCount(2);
    await expect(page.getByText(new RegExp(`^${t('messages:you')} \\u00B7`))).toHaveCount(1);
    // The composer is there and the loading text is gone.
    await expect(page.getByPlaceholder(t('messages:placeholder'))).toBeVisible();
    await expect(page.getByText(t('messages:loading'))).toHaveCount(0);
  });

  test('shows the empty text when the thread has no messages', async ({ page, mock, t }) => {
    mock.set({ messages: [], unread: 0 });
    await openMessages(page, t, 0);
    await expect(page.getByText(t('messages:empty'))).toBeVisible();
  });

  test('shows the load-failed text when the thread cannot be loaded', async ({ page, mock, t }) => {
    mock.override('GET', '/api/messages', 500, { error: 'Unable to load messages', code: 'messages_load_failed' });
    await openMessages(page, t);
    await expect(page.getByText(t('messages:loadFailed'))).toBeVisible();
    // The empty-thread text is NOT shown for a failed load.
    await expect(page.getByText(t('messages:empty'))).toHaveCount(0);
  });

  test('Send is disabled for an empty or whitespace-only draft and nothing is posted', async ({ page, mock, t }) => {
    await openMessages(page, t);
    const input = page.getByPlaceholder(t('messages:placeholder'));
    await expectSendDisabled(page, t, true);
    await input.fill('   ');
    await expectSendDisabled(page, t, true);
    // Real text enables it again.
    await input.fill('Hello');
    await expectSendDisabled(page, t, false);
    expect(mock.callsTo('POST', '/api/messages')).toHaveLength(0);
  });

  test('sending appends the message to the thread and clears the draft', async ({ page, mock, t }) => {
    await openMessages(page, t);
    const input = page.getByPlaceholder(t('messages:placeholder'));
    // Surrounding spaces are trimmed by the app before sending.
    await input.fill('  See you next week  ');
    await page.getByText(t('messages:send'), { exact: true }).click();

    await expect(page.getByText('See you next week', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    await expectSendDisabled(page, t, true);
    // Body of the request: the trimmed text, under `body`.
    expect(mock.callsTo('POST', '/api/messages')).toHaveLength(1);
    expect(mock.lastCall('POST', '/api/messages').body).toEqual({ body: 'See you next week' });
    // The user now has two "You" lines.
    await expect(page.getByText(new RegExp(`^${t('messages:you')} \\u00B7`))).toHaveCount(2);
  });

  // Each row: what the server answers -> the text the user sees. The app shows a text for the
  // server's error `code` (locale errors:<code>); an unknown code below 500 falls back to
  // messages:sendFailed; an unknown code at 500+ shows the "our side" text.
  const sendErrors = [
    { name: 'empty message code', status: 400, payload: { error: 'x', code: 'message_empty' }, text: t => t('errors:message_empty') },
    { name: 'too long code (uses params.max)', status: 400, payload: { error: 'x', code: 'message_too_long', params: { max: 2000 } }, text: t => t('errors:message_too_long', { max: 2000 }) },
    { name: 'hourly limit code', status: 429, payload: { error: 'x', code: 'message_rate_limited' }, text: t => t('errors:message_rate_limited') },
    { name: 'server-side send failure code', status: 500, payload: { error: 'x', code: 'message_send_failed' }, text: t => t('errors:message_send_failed') },
    { name: 'unknown 400 (generic messages fallback)', status: 400, payload: { error: 'boom' }, text: t => t('messages:sendFailed') },
    { name: 'unknown 500 (server_error text)', status: 500, payload: { error: 'boom' }, text: t => t('errors:server_error') },
  ];
  for (const c of sendErrors) {
    test(`send error: ${c.name}`, async ({ page, mock, t }) => {
      mock.override('POST', '/api/messages', c.status, c.payload);
      await openMessages(page, t);
      const input = page.getByPlaceholder(t('messages:placeholder'));
      await input.fill('Will this work?');
      await page.getByText(t('messages:send'), { exact: true }).click();
      await expect(page.getByText(c.text(t), { exact: true })).toBeVisible();
      // A failed send keeps the draft so the user can retry, and adds nothing to the thread.
      await expect(input).toHaveValue('Will this work?');
      await expect(page.getByText(new RegExp(`^${t('messages:you')} \u00B7`))).toHaveCount(1); // still only the fixture's own line
    });
  }

  test('opening Messages marks the thread read and the Home badge is gone after returning', async ({ page, mock, t }) => {
    await page.goto('/');
    // Home starts with the fixture badge (1 unread).
    await expect(page.getByLabel(t('home:messages.unread', { count: 1 }))).toBeVisible();
    await page.getByLabel(t('home:messages.unread', { count: 1 })).click();
    await expect(page.getByText('Great to hear.')).toBeVisible();
    // The fixture has an unread clinic message, so the app posts "read" (with an empty body).
    await expect.poll(() => mock.callsTo('POST', '/api/messages/read').length).toBe(1);
    expect(mock.lastCall('POST', '/api/messages/read').body).toEqual({});
    // The mock zeroes its unread counter when "read" is posted (like the server). Remember how
    // many count requests happened so far, then return to Home via the side menu ("My routine").
    const countCallsBefore = mock.callsTo('GET', '/api/messages/unread-count').length;
    await openMenu(page, t);
    // Listen for the count answer BEFORE the tap, so the asserts below run after the refetched
    // answer has come back (and can be applied to the badge).
    const countAnswer = page.waitForResponse((r) => r.url().endsWith('/api/messages/unread-count'));
    await tapMenuItem(page, t, 'menu:myRoutine');
    await countAnswer;
    // Home asks for the count again when it comes back: wait for that NEW request first.
    await expect.poll(() => mock.callsTo('GET', '/api/messages/unread-count').length).toBeGreaterThan(countCallsBefore);
    await expect(page.getByLabel(t('home:messages.label'), { exact: true })).toBeVisible();
    await expect(page.getByLabel(t('home:messages.unread', { count: 1 }))).toHaveCount(0);
  });

  test('does not post "read" when there are no unread clinic messages', async ({ page, mock, t }) => {
    // Only a read clinic message and an unread USER message: nothing for the clinic side to mark.
    mock.set({
      unread: 0,
      messages: [
        { id: 'a', from: 'admin', body: 'All read here', createdAt: '2026-09-25T10:00:00.000Z', readAt: '2026-09-25T10:05:00.000Z' },
        { id: 'b', from: 'user', body: 'My note', createdAt: '2026-09-25T10:30:00.000Z', readAt: null },
      ],
    });
    await openMessages(page, t, 0);
    await expect(page.getByText('All read here')).toBeVisible();
    // Go back to Home first: by then the screen has had all the time it needs to post "read".
    await openMenu(page, t);
    await tapMenuItem(page, t, 'menu:myRoutine');
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    expect(mock.callsTo('POST', '/api/messages/read')).toHaveLength(0);
  });
});

test.describe('Settings', () => {
  test('shows the era card, reminders section, reassess section, log out and credit', async ({ page, t }) => {
    await openSettings(page, t);
    // Era card comes from the saved analysis (fixture era name is English data).
    await expect(page.getByText('Barrier Healing Era')).toBeVisible();
    await expect(page.getByText(t('settings:eraSub'))).toBeVisible();
    await expect(page.getByText(t('settings:remindersTitle'))).toBeVisible();
    await expect(page.getByText(t('settings:reassessTitle'))).toBeVisible();
    await expect(page.getByText(t('settings:reassessDesc'))).toBeVisible();
    await expect(page.getByText(t('settings:retake'))).toBeVisible();
    await expect(page.getByText(t('settings:logout'))).toBeVisible();
    await expect(page.getByText(t('settings:tagline'))).toBeVisible();
    await expect(page.getByRole('link', { name: t('settings:dataCredit') })).toBeVisible();
  });

  test('on web the reminders are locked behind "Enable" and nothing is saved to the API', async ({ page, mock, t }) => {
    await openSettings(page, t);
    // Notifications are a native-app feature: on web permission is never granted, so only the
    // enable card shows, not the morning/evening rows or the Save button.
    await expect(page.getByText(t('settings:enableText'))).toBeVisible();
    await expect(page.getByText(t('settings:morning'))).toHaveCount(0);
    await expect(page.getByText(t('settings:saveReminders'))).toHaveCount(0);
    // Tapping Enable only shows a native alert (not observable on web); the screen is unchanged.
    await page.getByText(t('settings:enableAction')).click();
    await expect(page.getByText(t('settings:enableText'))).toBeVisible();
    await expect(page.getByText(t('settings:saveReminders'))).toHaveCount(0);
    // Settings never talks to /api/profile: reminders are stored on the device only.
    // (The task brief expected PATCH /api/profile; the current code has no such call.)
    expect(mock.callsTo('PATCH', '/api/profile')).toHaveLength(0);
  });

  test('Retake goes to the quiz with the stored consent (skips the intro)', async ({ page, mock, t }) => {
    await openSettings(page, t);
    await page.getByText(t('settings:retake')).click();
    // The fixture user already accepted the terms, so the app skips the intro and shows the
    // first quiz question (the name question).
    await expect(page.getByText(t('quiz:name.question'))).toBeVisible();
    await expect(page.getByText(t('settings:title'), { exact: true })).toHaveCount(0);
    // Retaking does not call the API by itself.
    expect(mock.callsTo('POST', '/api/analysis')).toHaveLength(0);
  });

  test('Log out returns to the Login screen and logs the activity', async ({ page, mock, t }) => {
    await openSettings(page, t);
    await page.getByText(t('settings:logout')).click();
    await expect(page.getByText(t('auth:login.tagline'))).toBeVisible();
    // logActivity('logout') is posted before the token is removed.
    // (An "app_open" activity is also posted at boot, so only count the "logout" events.)
    const logoutCalls = () => mock.callsTo('POST', '/api/activity').filter(c => c.body && c.body.event === 'logout');
    await expect.poll(() => logoutCalls().length).toBe(1);
    // The call carried the token: it was sent before the token was removed.
    expect(logoutCalls()[0].authed).toBe(true);
  });
});

// Messages and Settings have no Back text button any more: the edge swipe replaces it.
// The swipe gesture itself (both languages, thresholds, animation) is tested in swipe-back.spec.js;
// here we only keep the "no Back control" assertions and one swipe per screen.
test.describe('No Back button (swipe-back)', () => {
  test('Messages has no Back control; the edge swipe returns to Home', async ({ page, t }) => {
    await openMessages(page, t);
    await expect(backButton(page, t)).toHaveCount(0);
    await edgeSwipe(page, { lang: 'en', dx: 234 });
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.getByText(t('messages:title'), { exact: true })).toHaveCount(0);
  });

  test('Settings has no Back control; the edge swipe returns to Home', async ({ page, t }) => {
    await openSettings(page, t);
    await expect(backButton(page, t)).toHaveCount(0);
    await edgeSwipe(page, { lang: 'en', dx: 234 });
    await expect(page.getByText(t('home:greeting.morning'))).toBeVisible();
    await expect(page.getByText(t('settings:title'), { exact: true })).toHaveCount(0);
  });
});
