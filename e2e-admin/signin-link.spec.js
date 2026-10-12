// Admin e2e for SIGN-IN LINKS and INVITES, written TEST-FIRST against
// AI/plans/paid-booking-and-signin-link-contract.md (sections 4, 5.2, 5.3, 5.4). The feature code
// did not exist when this was written, so these specs are RED until it lands.
//
// What an admin can do: (a) create a one-time sign-in link for an existing customer, copy it,
// resend it by email, see its history; (b) invite a brand-new customer by email, which creates a
// pending invite with a link. The customer opens the link, which the app redeems through
// POST /api/auth/link/redeem (tested here at the API level; the app screens are covered by the
// mobile suite).
//
// Postmark is BLANK in this test environment (support/startServer.js), so no email is ever sent:
// creating a link or invite answers with the "*_not_sent" notice and shows the link in an input
// so the admin can copy it. Nothing here touches a real database or mail service; the only DB
// access is the guarded in-memory one (support/shopify.js withDb).
//
// Serial, shared DB: later specs reuse the user and the links made by earlier ones.
import { test, expect } from '@playwright/test';
import { signIn } from './support/session.js';
import { PORT, CONSENT_VERSION } from './support/env.js';
import { createUser, withDb } from './support/shopify.js';

test.describe.configure({ mode: 'serial' });

// Same shape as server PUBLIC_BASE_URL (set in startServer.js): the link is <base>/#signin=<token>.
const BASE = `http://127.0.0.1:${PORT}`;
const LINK_RE = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/#signin=[A-Za-z0-9_-]{43}$`);

// Shared between the serial specs.
const s = { user: null, token1: null, token2: null, inviteEmail: 'e2e-invitee@example.test', inviteToken: null, inviteId: null };

const notice = page => page.locator('.notice');
const signinSection = page => page.locator('section#signin-link');
const tokenOf = link => link.split('#signin=')[1];
const redeem = (request, data) => request.post('/api/auth/link/redeem', { data });

// Opens the user page, clicks "Create new link" and returns the raw token shown in the input.
async function createLink(page, userId) {
  await page.goto(`/admin/users/${userId}`);
  await signinSection(page).getByRole('button', { name: 'Create new link' }).click();
  await expect(notice(page)).toHaveText('Sign-in link created, but the email was not sent. Copy the link instead.');
  return tokenOf(await page.locator('#signin-link-url').inputValue());
}

test.describe('sign-in link and invites', () => {
  test.beforeEach(async ({ page, context }) => {
    await signIn(context);
    // Forms may ask "are you sure" through a confirm dialog; accept it.
    page.on('dialog', dialog => dialog.accept());
  });

  // 1. Create a link
  test('1. user page: Create new link shows the notice, the link input and one Active history item', async ({ page }) => {
    s.user = await createUser('e2e-link-user@example.test', 'Lena');
    await page.goto(`/admin/users/${s.user.id}`);
    const sec = signinSection(page);
    await expect(sec.getByRole('heading', { name: 'Sign-in link' })).toBeVisible();
    await sec.getByRole('button', { name: 'Create new link' }).click();

    await expect(notice(page)).toHaveText('Sign-in link created, but the email was not sent. Copy the link instead.');
    const url = await page.locator('#signin-link-url').inputValue();
    expect(url).toMatch(LINK_RE);
    s.token1 = tokenOf(url);

    const items = page.locator('#signin-link-history li[data-link-id]');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Active');
  });

  // 2. Copy button
  test('2. Copy link changes its text to Copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await page.goto(`/admin/users/${s.user.id}`);
    const copy = signinSection(page).getByRole('button', { name: 'Copy link' });
    await copy.click();
    await expect(copy).toHaveText('Copied');
  });

  // 3. Redeem once
  test('3. redeeming the token signs the customer in once; the page then shows Used', async ({ page, request }) => {
    const ok = await redeem(request, { token: s.token1 });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe(s.user.email);
    expect(body.isNew).toBe(false);

    // One-time: the same token again is refused.
    const again = await redeem(request, { token: s.token1 });
    expect(again.status()).toBe(400);
    expect((await again.json()).code).toBe('link_invalid');

    await page.goto(`/admin/users/${s.user.id}`);
    await expect(page.locator('#signin-link-history li[data-link-id]').first()).toContainText('Used');
    await expect(page.locator('#signin-link-url')).toHaveCount(0);
  });

  // 4. A newer link replaces the older active one
  test('4. creating a new link while one is active marks the older one Replaced and kills its token', async ({ page, request }) => {
    const older = await createLink(page, s.user.id);
    const newer = await createLink(page, s.user.id);
    expect(newer).not.toBe(older);
    s.token2 = newer;

    await expect(page.locator('#signin-link-history li[data-link-id]').filter({ hasText: 'Replaced' })).toHaveCount(1);
    const res = await redeem(request, { token: older });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('link_invalid');
  });

  // 5. Resend without mail configured
  test('5. Resend email with mail not configured says the email was not sent', async ({ page }) => {
    await page.goto(`/admin/users/${s.user.id}`);
    await signinSection(page).getByRole('button', { name: 'Resend email' }).click();
    await expect(notice(page)).toHaveText('The email was not sent. Copy the link instead.');
    // The link is still active and copyable.
    await expect(page.locator('#signin-link-url')).toHaveValue(LINK_RE);
  });

  // 6. Invite a new customer
  test('6. invite: link shown in Pending invites; redeem needs consent and then creates the account', async ({ page, request }) => {
    await page.goto('/admin/users');
    const form = page.locator('section#invite');
    await expect(form.getByRole('heading', { name: 'Invite a new customer' })).toBeVisible();
    await form.getByLabel('Email').fill(s.inviteEmail);
    await form.getByLabel('First name').fill('Ina');
    await form.getByLabel('Language').selectOption('en');
    await form.getByRole('button', { name: 'Send invite' }).click();
    await expect(notice(page)).toHaveText('Invite created, but the email was not sent. Copy the link instead.');

    const inviteRow = page.locator('section#invites tr[data-invite-id]').filter({ hasText: s.inviteEmail });
    await expect(inviteRow).toHaveCount(1);
    s.inviteId = await inviteRow.getAttribute('data-invite-id');
    const url = await inviteRow.locator('input[readonly]').inputValue();
    expect(url).toMatch(LINK_RE);
    s.inviteToken = tokenOf(url);

    // No consent: refused, and the link is NOT consumed.
    const noConsent = await redeem(request, { token: s.inviteToken });
    expect(noConsent.status()).toBe(400);
    expect((await noConsent.json()).code).toBe('consent_required');

    // With consent (stamped just now, current policy version): the account is created.
    const ok = await redeem(request, {
      token: s.inviteToken,
      consentAcceptedAt: new Date(Date.now() - 1000).toISOString(),
      consentVersion: CONSENT_VERSION,
    });
    expect(ok.status()).toBe(201);
    const body = await ok.json();
    expect(body.isNew).toBe(true);
    expect(body.user.email).toBe(s.inviteEmail);

    // The used invite leaves the pending list.
    await page.reload();
    await expect(page.locator(`section#invites tr[data-invite-id="${s.inviteId}"]`)).toHaveCount(0);
  });

  // 7. Existing email / invalid email
  test('7. invite for an existing account makes a sign-in link; an invalid email is rejected', async ({ page }) => {
    await page.goto('/admin/users');
    const form = page.locator('section#invite');
    await form.getByLabel('Email').fill(s.user.email);
    await form.getByLabel('First name').fill('Lena');
    await form.getByRole('button', { name: 'Send invite' }).click();
    await expect(notice(page)).toHaveText('That email already has an account. A sign-in link was created for it instead.');

    // The browser would block a bad address in an email input, so make it a plain text box.
    await form.getByLabel('Email').evaluate(el => { el.type = 'text'; });
    await form.getByLabel('Email').fill('not-an-email');
    await form.getByRole('button', { name: 'Send invite' }).click();
    await expect(notice(page)).toHaveText('Enter a valid email address.');
  });

  // 8. CSRF on all four POST routes
  test('8. the four POST routes without or with a wrong _csrf get 403 and create nothing', async ({ page, context }) => {
    const { csrf } = await signIn(context);
    // A real pending invite to try to resend (made with a VALID csrf).
    const email = 'e2e-csrf-invitee@example.test';
    const made = await page.request.post('/admin/invites', { form: { _csrf: csrf, email, firstName: 'Cy', language: 'en' }, maxRedirects: 0 });
    expect(made.status()).toBeLessThan(400);
    const counts = () => withDb(async ({ LoginLink }) => ({
      signin: await LoginLink.countDocuments({ userId: s.user.id, purpose: 'signin' }),
      invites: await LoginLink.countDocuments({ 'invite.email': 'e2e-csrf-new@example.test' }),
      invite: await LoginLink.findOne({ 'invite.email': email }).lean(),
    }));
    const before = await counts();
    const inviteId = String(before.invite._id);

    const routes = [
      [`/admin/users/${s.user.id}/signin-link`, {}],
      [`/admin/users/${s.user.id}/signin-link/resend`, {}],
      ['/admin/invites', { email: 'e2e-csrf-new@example.test', firstName: 'No', language: 'en' }],
      [`/admin/invites/${inviteId}/resend`, {}],
    ];
    for (const [url, body] of routes) {
      for (const extra of [{}, { _csrf: 'wrong-token' }]) {
        const res = await page.request.post(url, { form: { ...body, ...extra }, maxRedirects: 0 });
        expect(res.status(), url).toBe(403);
      }
    }
    const after = await counts();
    expect(after.signin).toBe(before.signin);
    expect(after.invites).toBe(0);
    expect(after.invite.sendCount).toBe(before.invite.sendCount);
  });

  // 9. Audit
  test('9. audit log shows signin link created and invite created', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.getByText('signin link created').first()).toBeVisible();
    await expect(page.getByText('invite created').first()).toBeVisible();
  });
});
