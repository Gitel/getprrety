// Admin catalogue e2e specs, written TEST-FIRST against AI/plans/sr-catalogue-ui-contract.md.
// They run against the REAL server with an in-memory MongoDB seeded by the REAL seed script
// (see support/startServer.js). Nothing here touches a real database.
//
// Specs share one DB and run serially in file order. Each spec uses its own product so they
// do not depend on each other's edits (spec 2 must still run before spec 5 creates a product,
// because it expects exactly the 34 seeded rows).
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from './support/session.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test.describe.configure({ mode: 'serial' });

// A valid 1x1 PNG (decoded from base64) used as the "new photo" fixture.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Opens the edit page of a seeded product by clicking its name link in the list.
async function openProduct(page, slug) {
  await page.goto('/admin/catalogue');
  await page.locator(`tr[data-product-slug="${slug}"] a`).first().click();
  await expect(page.locator('code.slug')).toHaveText(slug);
}

// The product id is the last path segment of the edit page URL.
function productId(page) {
  return new URL(page.url()).pathname.split('/').pop();
}

const notice = page => page.locator('.notice');

// ---------------------------------------------------------------------------------------
// 0. Infra smoke (does not need the catalogue UI)
// ---------------------------------------------------------------------------------------
test.describe('smoke', () => {
  test('signed-in admin sees the dashboard nav', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
  });

  test('signed-out /admin redirects to login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});

// ---------------------------------------------------------------------------------------
// Catalogue specs
// ---------------------------------------------------------------------------------------
test.describe('catalogue', () => {
  // 1. Signed out
  test('1. signed-out /admin/catalogue redirects to login', async ({ page }) => {
    await page.goto('/admin/catalogue');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  // 2. Nav + list + thumbnails
  test('2. nav link and list of 34 seeded products with thumbnails', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin');
    const navLink = page.getByRole('link', { name: 'Products' });
    await expect(navLink).toHaveAttribute('href', '/admin/catalogue');
    await navLink.click();
    await expect(page).toHaveURL(/\/admin\/catalogue$/);

    await expect(page.locator('tr[data-product-slug]')).toHaveCount(34);
    for (const slug of ['herbal-cleansing-mousse', 'caliente-peeling-mask', 'calm-forte-cream-mask']) {
      await expect(page.locator(`tr[data-product-slug="${slug}"]`)).toHaveCount(1);
    }

    // Thumbnails exist, and at least one really loads (naturalWidth > 0).
    const thumbs = page.locator('img[src^="/admin/catalogue/"]');
    expect(await thumbs.count()).toBeGreaterThan(0);
    await expect.poll(() =>
      page.evaluate(() => [...document.querySelectorAll('img[src^="/admin/catalogue/"]')]
        .some(img => img.complete && img.naturalWidth > 0))
    ).toBe(true);
  });

  // 3. Edit
  test('3. edit name, use and strengths; values persist; audit shows it', async ({ page, context }) => {
    await signIn(context);
    await openProduct(page, 'light-tomato-peel');
    const id = productId(page);

    const newName = 'Light Tomato Peel E2E';
    await page.getByLabel('Name', { exact: true }).fill(newName);
    await page.getByLabel('Use', { exact: true }).selectOption('guided');
    const strengths = page.getByLabel('Strengths', { exact: true });
    const before = await strengths.inputValue();
    await strengths.fill(`${before}\nE2E strength line`.trim());
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(notice(page)).toHaveText('Product saved.');

    // Reload: values kept, slug unchanged.
    await page.reload();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(newName);
    await expect(page.getByLabel('Use', { exact: true })).toHaveValue('guided');
    await expect(page.getByLabel('Strengths', { exact: true })).toHaveValue(/E2E strength line/);
    await expect(page.locator('code.slug')).toHaveText('light-tomato-peel');

    // Audit log lists the change with a link to the product.
    await page.goto('/admin/audit');
    await expect(page.getByText('catalogue product updated').first()).toBeVisible();
    await expect(page.locator(`a[href="/admin/catalogue/${id}"]`).first()).toHaveText('product');

    // Saving again without changes says nothing changed.
    await page.goto(`/admin/catalogue/${id}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(notice(page)).toHaveText('Nothing changed.');
  });

  // 4. Photo upload
  test('4. photo: valid PNG replaces bytes; text file is rejected', async ({ page, context }) => {
    await signIn(context);
    await openProduct(page, 'herbal-cleansing-mousse');
    const id = productId(page);

    await page.getByLabel('Photo', { exact: true }).setInputFiles({
      name: 'new.png', mimeType: 'image/png', buffer: TINY_PNG,
    });
    await page.getByRole('button', { name: 'Upload photo' }).click();
    await expect(notice(page)).toHaveText('Photo updated.');

    const res = await page.request.get(`/admin/catalogue/${id}/photo`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    expect(Buffer.compare(await res.body(), TINY_PNG)).toBe(0);

    // A non-image is rejected and the PNG we just stored stays.
    await page.getByLabel('Photo', { exact: true }).setInputFiles({
      name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image'),
    });
    await page.getByRole('button', { name: 'Upload photo' }).click();
    await expect(notice(page)).toHaveText('The photo must be a JPEG or PNG image of up to 2 MB.');
    const after = await page.request.get(`/admin/catalogue/${id}/photo`);
    expect(Buffer.compare(await after.body(), TINY_PNG)).toBe(0);
  });

  // 5. Create
  test('5. create a product; duplicate and empty names are rejected', async ({ page, context }) => {
    await signIn(context);
    await page.goto('/admin/catalogue/new');
    await page.getByLabel('Name', { exact: true }).fill('E2E Created Product');
    await page.getByLabel('Category', { exact: true }).selectOption('face_serums');
    await page.getByLabel('Use', { exact: true }).selectOption('home');
    await page.getByLabel('Pregnancy', { exact: true }).selectOption('not_stated');
    await page.getByLabel('Key actives', { exact: true }).fill('Vitamin C\nNiacinamide');
    await page.getByLabel('Strengths', { exact: true }).fill('Brightens');
    await page.getByRole('button', { name: 'Create product' }).click();

    await expect(page).toHaveURL(/\/admin\/catalogue\/[0-9a-f]{24}/);
    await expect(notice(page)).toHaveText('Product created.');
    await expect(page.locator('code.slug')).toHaveText('e2e-created-product');

    await page.goto('/admin/catalogue');
    await expect(page.locator('tr[data-product-slug="e2e-created-product"]')).toHaveCount(1);

    // Same name, different case -> 400 re-render with typed values kept.
    await page.goto('/admin/catalogue/new');
    await page.getByLabel('Name', { exact: true }).fill('E2E CREATED PRODUCT');
    // The three dropdowns are `required`: without them the browser itself blocks the submit
    // and the server's duplicate-name check is never reached.
    await page.getByLabel('Category', { exact: true }).selectOption('face_serums');
    await page.getByLabel('Use', { exact: true }).selectOption('home');
    await page.getByLabel('Pregnancy', { exact: true }).selectOption('not_stated');
    await page.getByLabel('Strengths', { exact: true }).fill('typed value');
    const [dupResponse] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && /\/admin\/catalogue$/.test(new URL(r.url()).pathname)),
      page.getByRole('button', { name: 'Create product' }).click(),
    ]);
    expect(dupResponse.status()).toBe(400);
    await expect(notice(page)).toHaveText('A product with this name already exists.');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('E2E CREATED PRODUCT');
    await expect(page.getByLabel('Strengths', { exact: true })).toHaveValue('typed value');
    await expect(page.getByLabel('Category', { exact: true })).toHaveValue('face_serums');

    // Empty name -> invalid notice. The input is "required", so turn off the browser's own
    // validation to let the SERVER validation run.
    await page.goto('/admin/catalogue/new');
    await page.locator('form:has(button:has-text("Create product"))').evaluate(f => { f.noValidate = true; });
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(notice(page)).toHaveText(
      'Please fill in the name and choose a valid category, use and pregnancy option.'
    );
  });

  // 6. Archive / restore
  test('6. archive then restore a product', async ({ page, context }) => {
    await signIn(context);
    page.on('dialog', dialog => dialog.accept()); // form[data-confirm] uses window.confirm
    const slug = 'calm-forte-cream-mask';
    await openProduct(page, slug);

    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(notice(page)).toHaveText('Product archived.');
    await page.goto('/admin/catalogue');
    await expect(page.locator(`tr[data-product-slug="${slug}"]`)).toContainText('Archived');

    await openProduct(page, slug);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(notice(page)).toHaveText('Product restored.');
    await page.goto('/admin/catalogue');
    await expect(page.locator(`tr[data-product-slug="${slug}"]`)).not.toContainText('Archived');
  });

  // 7. CSRF
  test('7. POST without or with a wrong _csrf gets 403', async ({ page, context }) => {
    await signIn(context);
    await openProduct(page, 'caliente-peeling-mask');
    const id = productId(page);
    const form = { name: 'x', category: 'masks', use: 'home', pregnancy: 'not_stated' };

    const missing = await page.request.post(`/admin/catalogue/${id}`, { form });
    expect(missing.status()).toBe(403);
    const wrong = await page.request.post(`/admin/catalogue/${id}`, { form: { ...form, _csrf: 'wrong-token' } });
    expect(wrong.status()).toBe(403);
  });

  // 8. Seed re-run keeps edits
  test('8. re-running the seed keeps edits and adds no duplicates', async ({ page, context }) => {
    await signIn(context);
    await openProduct(page, 'caliente-peeling-mask');
    const edited = 'Caliente Peeling Mask Edited';
    await page.getByLabel('Name', { exact: true }).fill(edited);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(notice(page)).toHaveText('Product saved.');

    await page.goto('/admin/catalogue');
    const rowsBefore = await page.locator('tr[data-product-slug]').count();

    // Same memory DB the server uses (URI written by startServer.js). Guard: local only.
    const { uri } = JSON.parse(readFileSync(path.join(here, '.tmp', 'db.json'), 'utf8'));
    expect(uri).toMatch(/^mongodb:\/\/(127\.0\.0\.1|localhost)/);
    const run = spawnSync(process.execPath, [path.resolve(here, '../server/scripts/seedCatalogue.js')], {
      env: { ...process.env, MONGODB_URI: uri, NODE_ENV: 'test' },
      cwd: here, encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    const lastLine = run.stdout.trim().split('\n').pop().trim();
    expect(lastLine).toMatch(/^Inserted 0, skipped \d+ \(already present\)\.$/);

    await page.goto('/admin/catalogue');
    await expect(page.locator('tr[data-product-slug]')).toHaveCount(rowsBefore);
    await expect(page.locator('tr[data-product-slug="caliente-peeling-mask"]')).toContainText(edited);
  });
});
