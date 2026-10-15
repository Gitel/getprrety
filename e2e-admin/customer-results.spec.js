// Admin customer-page e2e specs for editing a customer's results, written TEST-FIRST against
// AI/plans/catalogue-recs-and-ai-admin-contract.md section 5. The features do not exist yet
// (product pickers, "reading" and "safety" editors), so these specs are EXPECTED to fail until T5.
// They run against the REAL server with an in-memory MongoDB. Customers, analyses and scans are
// seeded straight into that DB by support/seedCustomer.js (real models, in-memory URI only).
//
// Specs share one DB. Each spec seeds its OWN customer so they do not depend on
// each other's edits.
import { test, expect } from '@playwright/test';
import { signIn } from './support/session.js';
import { seedCustomer, catalogueIdBySlug, loadStored, OPEN_QUIZ } from './support/seedCustomer.js';

// Not 'serial': a failing spec should not hide the rest (they run in file order with one worker anyway).
// Order still matters only inside a describe, and each spec seeds/uses its own data.
test.describe.configure({ mode: 'default' });

const customerUrl = id => `/admin/customer/${id}`;
const notice = page => page.locator('.notice');

// Seeded catalogue products used below (see server/data/catalogue-seed/products.json):
//  - one-step-peel:         home use, pregnancy 'safe'  -> ELIGIBLE for a pregnancy-caution customer
//  - caffeine-renewing-mask: home use, pregnancy 'avoid' -> INELIGIBLE for a pregnancy-caution customer
const ELIGIBLE_SLUG = 'one-step-peel';
const INELIGIBLE_SLUG = 'caffeine-renewing-mask';

// Submits a data-json-editor form and waits for its POST; returns the response.
async function saveSection(page, section) {
  const [res] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/edit/${section}`)),
    page.locator(`#${section} form[data-json-editor] button[type="submit"]`).click(),
  ]);
  return res;
}

// ---------------------------------------------------------------------------------------
// 0. Seeding helper smoke test (does not need the new features)
// ---------------------------------------------------------------------------------------
test.describe('seed helper', () => {
  test('0. a seeded analysis opens on /admin/customer/<id>', async ({ page, context }) => {
    await signIn(context);
    const { analysisId } = await seedCustomer();
    const res = await page.goto(customerUrl(analysisId));
    expect(res.status()).toBe(200);
    await expect(page.locator('#fields')).toBeVisible();
    await expect(page.locator('#sr')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------
// 1. Product pickers
// ---------------------------------------------------------------------------------------
test.describe('product pickers', () => {
  test('1. pickers exist with "No product" + catalogue options', async ({ page, context }) => {
    await signIn(context);
    const { analysisId } = await seedCustomer({ quizAnswers: OPEN_QUIZ });
    await page.goto(customerUrl(analysisId));

    // SR hero picker is on the page from the start.
    const hero = page.locator('#sr select[data-product-picker][data-path="srProducts.era_hero_product.sr_product_id"]');
    await expect(hero).toHaveCount(1);
    const options = await hero.locator('option').evaluateAll(os => os.map(o => ({ value: o.value, text: o.textContent.trim() })));
    expect(options[0]).toMatchObject({ value: '' }); // "No product" comes first
    const peel = await catalogueIdBySlug(ELIGIBLE_SLUG);
    expect(options).toContainEqual({ value: peel.id, text: peel.name });
    expect(options.length).toBeGreaterThan(20); // the active home-use catalogue

    // Rows added on the fly get pickers too: SR step, audit replace "to", shelf product.
    await page.locator('#sr button[data-row-action="add"]').first().click();
    await expect(page.locator('#sr select[data-product-picker][data-path="sr_product_id"]')).toHaveCount(1);
    await page.locator('#audit .list-wrap', { hasText: 'Replace' }).locator('button[data-row-action="add"]').click();
    await expect(page.locator('#audit select[data-product-picker][data-path="to_product_id"]')).toHaveCount(1);
    await page.locator('#shelf button[data-row-action="add"]').click();
    await expect(page.locator('#shelf select[data-product-picker][data-path="sr_substitute_product_id"]')).toHaveCount(1);
    await expect(page.locator('#shelf select[data-product-picker][data-path="shelfAnalysis.transition_plan.first_sr_purchase_product_id"]')).toHaveCount(1);
  });

  test('2. picking an eligible product saves and its name appears', async ({ page, context }) => {
    await signIn(context);
    const { analysisId } = await seedCustomer(); // pregnancy-caution customer
    const peel = await catalogueIdBySlug(ELIGIBLE_SLUG);
    await page.goto(customerUrl(analysisId));

    const hero = page.locator('#sr select[data-path="srProducts.era_hero_product.sr_product_id"]');
    await hero.selectOption(peel.id);
    const res = await saveSection(page, 'sr');
    expect(res.status()).toBe(200);
    await expect(notice(page)).toBeVisible(); // analysis_saved banner after the redirect

    // After reload the picker still has the product selected and the server stored its name.
    await page.reload();
    await expect(page.locator('#sr select[data-path="srProducts.era_hero_product.sr_product_id"]')).toHaveValue(peel.id);
    const { analysis } = await loadStored(analysisId);
    expect(analysis.srProducts.era_hero_product.sr_product_id).toBe(peel.id);
    expect(analysis.srProducts.era_hero_product.sr_product_name).toBe(peel.name);
  });

  test('3. picking an INELIGIBLE product (pregnancy caution) is refused and changes nothing', async ({ page, context }) => {
    await signIn(context);
    const { analysisId } = await seedCustomer(); // pregnancy-caution customer
    const bad = await catalogueIdBySlug(INELIGIBLE_SLUG);
    await page.goto(customerUrl(analysisId));

    await page.locator('#sr select[data-path="srProducts.era_hero_product.sr_product_id"]').selectOption(bad.id);
    const res = await saveSection(page, 'sr');
    expect(res.status()).toBe(400);
    await expect(page.locator('#sr .editor-status.error')).toContainText('not suitable for this customer');

    const { analysis } = await loadStored(analysisId);
    expect(analysis.srProducts.era_hero_product.sr_product_id || '').toBe('');
    expect(analysis.srProducts.era_hero_product.sr_product_name).toBe('x'); // the seeded value
  });
});

// ---------------------------------------------------------------------------------------
// 2. Reading section
// ---------------------------------------------------------------------------------------
test.describe('reading section', () => {
  test('4. the reading card shows only when the scan has a reading', async ({ page, context }) => {
    await signIn(context);
    const withReading = await seedCustomer();
    const without = await seedCustomer({ withReading: false });
    await page.goto(customerUrl(withReading.analysisId));
    await expect(page.locator('#reading')).toBeVisible();
    await page.goto(customerUrl(without.analysisId));
    await expect(page.locator('#reading')).toHaveCount(0);
  });

  test('5. editing startHere and one signal "why" persists; potential and weeks are kept', async ({ page, context }) => {
    await signIn(context);
    const { analysisId } = await seedCustomer();
    await page.goto(customerUrl(analysisId));

    const card = page.locator('#reading');
    await card.locator('[data-path="startHere.title"]').fill('Edited start title');
    await card.locator('[data-path="startHere.body"]').fill('Edited start body text.');
    const firstSignal = card.locator('.row').first(); // the "barrier" signal
    await firstSignal.locator('[data-path="why"]').fill('Edited why for barrier.');
    const res = await saveSection(page, 'reading');
    expect(res.status()).toBe(200);

    // Persists after reload, in the form...
    await page.reload();
    await expect(page.locator('#reading [data-path="startHere.title"]')).toHaveValue('Edited start title');
    await expect(page.locator('#reading [data-path="startHere.body"]')).toHaveValue('Edited start body text.');
    await expect(page.locator('#reading .row').first().locator('[data-path="why"]')).toHaveValue('Edited why for barrier.');

    // ...and in the stored reading, where the non-editable fields are unchanged.
    const { reading } = await loadStored(analysisId);
    expect(reading.startHere).toEqual({ title: 'Edited start title', body: 'Edited start body text.' });
    const barrier = reading.signals.find(s => s.key === 'barrier');
    expect(barrier.why).toBe('Edited why for barrier.');
    expect(barrier.potential).toBe(90);
    expect(barrier.weeks).toBe('6-8 weeks');
    expect(barrier.driver).toBe('Dry weather'); // not edited, kept
    const clarity = reading.signals.find(s => s.key === 'clarity');
    expect(clarity.potential).toBe(85);
    expect(clarity.why).toBe('Pores look clogged.');
  });
});

// ---------------------------------------------------------------------------------------
// 3. Safety section
// ---------------------------------------------------------------------------------------
test.describe('safety section', () => {
  test('6. safetyFlags and checkInPrompts (one per line) save and persist', async ({ page, context }) => {
    await signIn(context);
    const { analysisId } = await seedCustomer();
    await page.goto(customerUrl(analysisId));

    const card = page.locator('#safety');
    await expect(card.locator('textarea[data-path="safetyFlags"]')).toHaveValue('Seed flag');
    await card.locator('textarea[data-path="safetyFlags"]').fill('Flag one\nFlag two');
    await card.locator('textarea[data-path="checkInPrompts"]').fill('How is your skin today?\nAny irritation?');
    const res = await saveSection(page, 'safety');
    expect(res.status()).toBe(200);

    await page.reload();
    await expect(page.locator('#safety textarea[data-path="safetyFlags"]')).toHaveValue('Flag one\nFlag two');
    await expect(page.locator('#safety textarea[data-path="checkInPrompts"]')).toHaveValue('How is your skin today?\nAny irritation?');
    const { analysis } = await loadStored(analysisId);
    expect(analysis.safetyFlags).toEqual(['Flag one', 'Flag two']);
    expect(analysis.checkInPrompts).toEqual(['How is your skin today?', 'Any irritation?']);
  });
});

// ---------------------------------------------------------------------------------------
// 4. Audit log
// ---------------------------------------------------------------------------------------
test.describe('audit', () => {
  test('7. the audit log lists score_reading_updated and safety_updated', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/audit');
    // The audit page prints action names with underscores turned into spaces.
    await expect(page.getByText('score reading updated').first()).toBeVisible();
    await expect(page.getByText('safety updated').first()).toBeVisible();
  });
});
