// Admin "AI settings" e2e specs, written TEST-FIRST against
// AI/plans/catalogue-recs-and-ai-admin-contract.md section 4. The pages do not exist yet, so
// these specs are EXPECTED to fail until tasks T4 (service) and T7 (UI) land.
// They run against the REAL server with an in-memory MongoDB (see support/startServer.js).
// Bedrock is OFF in this server, so the "test" button must answer "AI is not configured".
//
// All specs share one DB and run in file order (one worker). Each group uses its own AI key
// (skin_analysis, score_reading, market_picks) so they do not depend on each other's edits.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from './support/session.js';
import { ADMIN_EMAIL, PORT } from './support/env.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// support/session.js already set ADMIN_SESSION_SECRET, so the real signSession signs correctly here.
const { signSession, COOKIE_NAME } = require(path.resolve(here, '../server/services/adminAuth.js'));

// Not 'serial': a failing spec should not hide the rest (they run in file order with one worker anyway).
// Order still matters only inside a describe, and each spec seeds/uses its own data.
test.describe.configure({ mode: 'default' });

const notice = page => page.locator('.notice');
const editUrl = key => `/admin/ai/${key}`;

// Fills the edit form with the given values (any omitted field is left alone).
async function fillForm(page, { guidance, timeoutSec, maxOutputTokens, maxCostUsd, note } = {}) {
  const form = page.locator('form#ai-config-form');
  if (guidance !== undefined) await form.locator('textarea[name="guidance"]').fill(guidance);
  if (timeoutSec !== undefined) await form.locator('input[name="timeoutSec"]').fill(String(timeoutSec));
  if (maxOutputTokens !== undefined) await form.locator('input[name="maxOutputTokens"]').fill(String(maxOutputTokens));
  if (maxCostUsd !== undefined) await form.locator('input[name="maxCostUsd"]').fill(String(maxCostUsd));
  if (note !== undefined) await form.locator('input[name="note"]').fill(note);
}

// Clicks Publish and waits for the POST to finish; returns the response of that POST.
async function publish(page, key) {
  const [res] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === editUrl(key)),
    page.locator('form#ai-config-form button[data-action="publish"]').click(),
  ]);
  return res;
}

// The form body the browser would send for a publish with these values.
const validForm = (csrf, extra = {}) => ({
  _csrf: csrf, guidance: 'g', timeoutSec: '60', maxOutputTokens: '1000', maxCostUsd: '0.10', note: 'n', ...extra,
});

// The JSON the "Test" button sends (current form values + the chosen sample case).
const testBody = { guidance: 'g', timeoutSec: 60, maxOutputTokens: 1000, maxCostUsd: 0.1, note: '', sampleCase: 'en_basic' };

// ---------------------------------------------------------------------------------------
// 1. List page + nav
// ---------------------------------------------------------------------------------------
test.describe('list page', () => {
  test('1. signed-out /admin/ai redirects to login', async ({ page }) => {
    await page.goto('/admin/ai');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('2. nav link "AI settings" and one row per key, all on the built-in default', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin');
    const link = page.getByRole('link', { name: 'AI settings' });
    await expect(link).toHaveAttribute('href', '/admin/ai');
    await link.click();
    await expect(page).toHaveURL(/\/admin\/ai$/);

    for (const key of ['skin_analysis', 'score_reading', 'market_picks']) {
      const row = page.locator(`tr[data-ai-key="${key}"]`);
      await expect(row).toHaveCount(1);
      await expect(row.locator(`a[href="/admin/ai/${key}"]`).first()).toBeVisible();
      await expect(row.locator('.ai-active-version')).toContainText('Built-in default');
    }
    await expect(page.locator('tr[data-ai-key="skin_analysis"]')).toContainText('Skin analysis');
    await expect(page.locator('tr[data-ai-key="score_reading"]')).toContainText('Score reading');
    await expect(page.locator('tr[data-ai-key="market_picks"]')).toContainText('Market picks');
  });
});

// ---------------------------------------------------------------------------------------
// 2. Edit page
// ---------------------------------------------------------------------------------------
test.describe('edit page', () => {
  test('3. shows locked rules, guidance, limits with ranges, note, test area and history table', async ({ page, context }) => {
    await signIn(context);
    await page.goto(editUrl('skin_analysis'));

    await expect(page.locator('pre.locked-rules')).toBeVisible();
    const form = page.locator('form#ai-config-form');
    await expect(form.locator('input[name="_csrf"]')).toHaveCount(1);
    await expect(form.locator('textarea[name="guidance"]')).toBeVisible();
    // Built-in defaults for skin_analysis (contract section 4).
    await expect(form.locator('input[name="timeoutSec"]')).toHaveValue('90');
    await expect(form.locator('input[name="maxOutputTokens"]')).toHaveValue('8000');
    await expect(form.locator('input[name="maxCostUsd"]')).toHaveValue('0.25');
    await expect(form.locator('input[name="note"]')).toBeVisible();
    await expect(form.locator('button[data-action="publish"]')).toBeVisible();
    // The allowed range is shown next to each limit.
    await expect(form).toContainText('20');
    await expect(form).toContainText('500');
    await expect(form).toContainText('0.05');
    // Test area: sample cases differ per key.
    expect(await page.locator('select[name="sampleCase"] option').evaluateAll(os => os.map(o => o.value)))
      .toEqual(['en_basic', 'he_pregnancy', 'en_allergy']);
    await expect(page.locator('button[data-action="test"]')).toBeVisible();
    await expect(page.locator('table.ai-history')).toBeVisible();

    await page.goto(editUrl('score_reading'));
    expect(await page.locator('select[name="sampleCase"] option').evaluateAll(os => os.map(o => o.value)))
      .toEqual(['default']);
  });

  test('4. an unknown key is a 404', async ({ page, context }) => {
    await signIn(context);
    const res = await page.goto('/admin/ai/not_a_key');
    expect(res.status()).toBe(404);
  });

  test('5. the test button reports that AI is not configured (Bedrock is off here)', async ({ page, context }) => {
    await signIn(context);
    await page.goto(editUrl('skin_analysis'));
    await page.locator('button[data-action="test"]').click();
    await expect(page.locator('#ai-test-result')).toContainText('AI is not configured on this server');
  });
});

// ---------------------------------------------------------------------------------------
// 3. Publish + history (skin_analysis)
// ---------------------------------------------------------------------------------------
test.describe('publish', () => {
  test('6. publishing creates a version in the history and changes the active version', async ({ page, context }) => {
    await signIn(context);
    await page.goto(editUrl('skin_analysis'));
    const rowsBefore = await page.locator('table.ai-history tr[data-version-id]').count();

    await fillForm(page, { guidance: 'E2E guidance one', timeoutSec: 60, maxOutputTokens: 4000, maxCostUsd: 0.1, note: 'e2e first' });
    const res = await publish(page, 'skin_analysis');
    expect(res.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/admin\/ai\/skin_analysis\?notice=ai_published/);
    await expect(notice(page)).toHaveText('Saved and live for new analyses.');

    // The edit page now shows the live values and one more history row.
    await expect(page.locator('textarea[name="guidance"]')).toHaveValue('E2E guidance one');
    await expect(page.locator('input[name="timeoutSec"]')).toHaveValue('60');
    await expect(page.locator('table.ai-history tr[data-version-id]')).toHaveCount(rowsBefore + 1);
    await expect(page.locator('table.ai-history tr[data-version-id]').first()).toContainText('e2e first');

    // The list page says who saved the live version; the other keys are untouched.
    await page.goto('/admin/ai');
    await expect(page.locator('tr[data-ai-key="skin_analysis"] .ai-active-version'))
      .toContainText(`Saved by ${ADMIN_EMAIL}`);
    await expect(page.locator('tr[data-ai-key="score_reading"] .ai-active-version')).toContainText('Built-in default');
  });
});

// ---------------------------------------------------------------------------------------
// 4. Bounds (score_reading)
// ---------------------------------------------------------------------------------------
test.describe('bounds', () => {
  test('7. out-of-range limits give 400 + field errors in the UI and save nothing', async ({ page, context }) => {
    await signIn(context);
    await page.goto(editUrl('score_reading'));
    // Browser min/max validation would stop the submit before the server sees it; turn it off.
    await page.locator('form#ai-config-form').evaluate(f => { f.noValidate = true; });
    await fillForm(page, { guidance: 'should not be saved', timeoutSec: 5, maxOutputTokens: 99999, maxCostUsd: 0.9 });
    const res = await publish(page, 'score_reading');
    expect(res.status()).toBe(400);
    await expect(notice(page)).toHaveText('Please fix the highlighted fields.');
    for (const field of ['timeoutSec', 'maxOutputTokens', 'maxCostUsd']) {
      await expect(page.locator(`.field-error[data-field="${field}"]`)).toBeVisible();
    }
    // Typed values are kept in the re-rendered form.
    await expect(page.locator('input[name="timeoutSec"]')).toHaveValue('5');
    await expect(page.locator('textarea[name="guidance"]')).toHaveValue('should not be saved');

    // Nothing was saved: still the built-in default.
    await page.goto('/admin/ai');
    await expect(page.locator('tr[data-ai-key="score_reading"] .ai-active-version')).toContainText('Built-in default');
    await page.goto(editUrl('score_reading'));
    await expect(page.locator('input[name="timeoutSec"]')).toHaveValue('90');
  });

  test('8. each bound is enforced on the server (direct POSTs)', async ({ page, context }) => {
    const { csrf } = await signIn(context);
    const cases = [
      ['timeoutSec', '19'], ['timeoutSec', '91'], ['timeoutSec', '30.5'],
      ['maxOutputTokens', '499'], ['maxOutputTokens', '8001'],
      ['maxCostUsd', '0.04'], ['maxCostUsd', '0.51'], ['maxCostUsd', '0.123'],
      ['guidance', 'x'.repeat(8001)], ['note', 'x'.repeat(201)],
    ];
    for (const [field, value] of cases) {
      const res = await page.request.post(editUrl('score_reading'), { form: validForm(csrf, { [field]: value }) });
      expect(res.status(), `${field}=${value.slice(0, 10)}`).toBe(400);
      expect(await res.text()).toContain(`data-field="${field}"`);
    }
    // Still nothing saved.
    await page.goto('/admin/ai');
    await expect(page.locator('tr[data-ai-key="score_reading"] .ai-active-version')).toContainText('Built-in default');
  });

  test('8b. the exact edge values are accepted', async ({ page, context }) => {
    const { csrf } = await signIn(context);
    const res = await page.request.post(editUrl('score_reading'), {
      form: validForm(csrf, { guidance: '', timeoutSec: '20', maxOutputTokens: '500', maxCostUsd: '0.05', note: '' }),
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toContain('notice=ai_published');
  });
});

// ---------------------------------------------------------------------------------------
// 5. Restore (market_picks)
// ---------------------------------------------------------------------------------------
test.describe('restore', () => {
  test('9. restore an older version, then restore the built-in default', async ({ page, context }) => {
    await signIn(context);
    await page.goto(editUrl('market_picks'));
    await fillForm(page, { guidance: 'Market V1', note: 'marker-one' });
    await publish(page, 'market_picks');
    await fillForm(page, { guidance: 'Market V2', note: 'marker-two' });
    await publish(page, 'market_picks');
    await expect(page.locator('textarea[name="guidance"]')).toHaveValue('Market V2');

    // Restore the older version (found by its note).
    const oldRow = page.locator('table.ai-history tr[data-version-id]', { hasText: 'marker-one' });
    await oldRow.locator('button[data-action="restore"]').click();
    await expect(page).toHaveURL(/\/admin\/ai\/market_picks\?notice=ai_restored/);
    await expect(notice(page)).toHaveText('Restored. This version is now live.');
    await expect(page.locator('textarea[name="guidance"]')).toHaveValue('Market V1');

    // Restore the built-in default.
    await page.locator('form[data-restore-default] button').click();
    await expect(notice(page)).toHaveText('Restored. This version is now live.');
    await expect(page.locator('textarea[name="guidance"]')).not.toHaveValue(/Market V/);
    await page.goto('/admin/ai');
    await expect(page.locator('tr[data-ai-key="market_picks"] .ai-active-version')).toContainText('Built-in default');
  });
});

// ---------------------------------------------------------------------------------------
// 6. CSRF + permissions
// ---------------------------------------------------------------------------------------
test.describe('csrf and permissions', () => {
  test('10. publish, test and restore without or with a wrong _csrf get 403', async ({ page, context }) => {
    await signIn(context);
    for (const extra of [{}, { _csrf: 'wrong-token' }]) {
      const form = validForm('x');
      delete form._csrf;
      const pub = await page.request.post(editUrl('skin_analysis'), { form: { ...form, ...extra } });
      expect(pub.status()).toBe(403);
      const restore = await page.request.post(`${editUrl('skin_analysis')}/restore`, { form: { versionId: 'default', ...extra } });
      expect(restore.status()).toBe(403);
    }
    const res = await page.request.post(`${editUrl('skin_analysis')}/test`, { data: testBody });
    expect(res.status()).toBe(403);
  });

  test('11. a non-built-in admin sees a read-only page and gets 403 on every POST', async ({ page, context, browser }) => {
    // Add a dashboard admin (NOT in ADMIN_ALLOWED_EMAILS) through the real Admins page.
    const { csrf } = await signIn(context);
    const email = 'ai-readonly@example.test';
    const add = await page.request.post('/admin/admins', { form: { _csrf: csrf, email }, maxRedirects: 0 });
    expect(add.status()).toBe(302);

    // A second browser context signed in as that admin, via the real signSession.
    const origin = `http://127.0.0.1:${PORT}`;
    const other = await browser.newContext();
    const token = signSession(email);
    const otherCsrf = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).csrf;
    await other.addCookies([{ name: COOKIE_NAME, value: token, domain: '127.0.0.1', path: '/admin' }]);
    const p = await other.newPage();

    await p.goto(`${origin}/admin/ai/skin_analysis`);
    await expect(p.locator('textarea[name="guidance"][readonly]')).toBeVisible();
    await expect(p.locator('button[data-action="publish"]')).toHaveCount(0);
    await expect(p.locator('button[data-action="test"]')).toHaveCount(0);
    await expect(p.locator('button[data-action="restore"]')).toHaveCount(0);
    await expect(p.locator('.notice')).toHaveText('Only built-in admins can change AI settings.');

    const pub = await p.request.post(`${origin}/admin/ai/skin_analysis`, { form: validForm(otherCsrf) });
    expect(pub.status()).toBe(403);
    const restore = await p.request.post(`${origin}/admin/ai/skin_analysis/restore`, { form: { _csrf: otherCsrf, versionId: 'default' } });
    expect(restore.status()).toBe(403);
    const res = await p.request.post(`${origin}/admin/ai/skin_analysis/test`, {
      headers: { 'X-CSRF-Token': otherCsrf }, data: testBody,
    });
    expect(res.status()).toBe(403);
    await other.close();
  });
});

// ---------------------------------------------------------------------------------------
// 7. Audit log
// ---------------------------------------------------------------------------------------
test.describe('audit', () => {
  test('12. the audit log lists ai_config_published and ai_config_restored', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/audit');
    // The audit page prints action names with underscores turned into spaces.
    await expect(page.getByText('ai config published').first()).toBeVisible();
    await expect(page.getByText('ai config restored').first()).toBeVisible();
  });
});
