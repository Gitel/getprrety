// Behaviour tests for the new "My products" screen (item 5 of the catalogue-recs plan).
//
// TEST-FIRST: this file was written BEFORE the screen exists, against
// AI/plans/catalogue-recs-and-ai-admin-contract.md (sections 1, 2, 3 and 6). Until the feature lands
// these tests are expected to FAIL (missing menu item, missing testIDs, endpoint never called). Once
// T6-T9 are implemented they must pass without edits.
//
// Notes for a junior developer:
//   - The app has no URLs: we reach the screen by clicking the side menu item, like a user.
//   - react-native-web renders `testID` as `data-testid`, so we use page.getByTestId(...).
//   - The mock serves the catalogue from fixtures CATALOGUE (fixtures-data.js): the cleanser has a photo
//     and a price but no shop link, the moisturizer has photo + price + https link (Buy button), the
//     serum has nothing, and one archived product exists for the "No longer available" case.
//   - The same product can appear in several sections at once (ritual, replace, hero), so cards are
//     always looked up INSIDE a section testID, never page-wide (that would break strict mode).
//   - Market picks ("Other options", POST /api/ai/product-recommendations) used to be tested in the
//     Profile tests; those assertions moved here.
import { test, expect } from './support/test.js';
import { ANALYSIS, PID, CATALOGUE, SHOP_URL } from './support/fixtures-data.js';
import { makeT } from './support/i18n.js';
import { openMenu, panelOf } from './support/nav.js';

test.use({ signedIn: true });

const MIDDLE_DOT = String.fromCharCode(0xb7);

// Prices render with Intl.NumberFormat(lang, { style: 'currency', currency: 'ILS' }) (contract section 3).
// Whitespace is normalised because Intl may use a no-break space, and Playwright text matching does too.
const ils = (lang, amount) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'ILS' }).format(amount).replace(/\s/g, ' ');

// Boots the app, opens the side menu and taps "My products", then waits for the screen hero.
// The row is looked up INSIDE the panel so it never matches same-named text behind it (Home card).
async function openMyProducts(page, t) {
  await page.goto('/');
  await openMenu(page, t);
  await panelOf(page, t).getByText(t('menu:myProducts'), { exact: true }).click();
  await expect(page.getByTestId('myproducts-hero')).toBeVisible();
}

// A product card inside one section of the screen.
const card = (page, section, id) => page.getByTestId(section).getByTestId(`product-card-${id}`);

// The photo URL of a card, whether react-native-web renders the image as an <img> child or as a
// background-image div. Returned as a string (empty when there is no image).
const photoSrc = (page, id) => page.getByTestId(`product-photo-${id}`).evaluate((node) => {
  const img = node.tagName === 'IMG' ? node : node.querySelector('img');
  return (img && (img.getAttribute('src') || img.currentSrc)) || getComputedStyle(node).backgroundImage || '';
});

// Variants of the fixture analysis for the data-dependent cases (structuredClone: never mutate the fixture).
const variant = (edit) => { const a = structuredClone(ANALYSIS); edit(a); return a; };

test.describe('entry point: side menu', () => {
  test('the menu has a "My products" row after "My skin profile" and it opens the screen', async ({ page, t }) => {
    await page.goto('/');
    await openMenu(page, t);
    const panel = panelOf(page, t);
    const profileRow = await panel.getByText(t('menu:mySkinProfile'), { exact: true }).boundingBox();
    const productsRow = await panel.getByText(t('menu:myProducts'), { exact: true }).boundingBox();
    // The menu is a vertical list: "after" means lower on the screen.
    expect(productsRow.y).toBeGreaterThan(profileRow.y);
    await panel.getByText(t('menu:myProducts'), { exact: true }).click();
    await expect(page.getByTestId('myproducts-hero')).toBeVisible();
    // Home is gone (only the top screen is mounted).
    await expect(page.getByText(t('home:greeting.morning'))).toHaveCount(0);
  });
});

test.describe('with the full fixture analysis', () => {
  test('shows the hero, ritual, replace, shelf, other options and audit sections, not the empty state', async ({ page, t }) => {
    await openMyProducts(page, t);
    for (const id of ['myproducts-hero', 'myproducts-ritual', 'myproducts-replace', 'myproducts-shelf',
      'myproducts-other-options', 'myproducts-audit']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId('myproducts-empty')).toHaveCount(0);
    // The hero names the era's hero product and why.
    await expect(page.getByTestId('myproducts-hero')).toContainText('Barrier Repair Cream');
    await expect(page.getByTestId('myproducts-hero')).toContainText('The one product that moves your era the most.');
  });

  test('asks the catalogue (authed) for the ids of the analysis products', async ({ page, t, mock }) => {
    await openMyProducts(page, t);
    await expect.poll(() => mock.callsTo('GET', '/api/catalogue/products').length).toBeGreaterThan(0);
    const ids = new Set(mock.callsTo('GET', '/api/catalogue/products').flatMap((c) => c.query.ids.split(',')));
    // Every SR step product and the replacement product; never a non-catalogue value.
    for (const id of [PID.cleanser, PID.moisturizer, PID.serum]) expect(ids.has(id)).toBe(true);
    for (const c of mock.callsTo('GET', '/api/catalogue/products')) expect(c.authed).toBe(true);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{24}$/);
  });

  test.describe('SR ritual (Morning / Evening tabs)', () => {
    test('Morning is the default: matched cards, the unmatched step note, no PM-only product', async ({ page, t }) => {
      await openMyProducts(page, t);
      const ritual = page.getByTestId('myproducts-ritual');
      await expect(card(page, 'myproducts-ritual', PID.cleanser)).toContainText('Gentle Gel Cleanser');
      await expect(card(page, 'myproducts-ritual', PID.moisturizer)).toContainText('Barrier Repair Cream');
      // The unmatched sunscreen step shows analysis no-match note instead of a product.
      await expect(ritual.getByText('Use your own mineral SPF 30+ as the last morning step.')).toBeVisible();
      await expect(card(page, 'myproducts-ritual', PID.serum)).toHaveCount(0);
    });

    test('the Evening tab swaps the steps and back again', async ({ page, t }) => {
      await openMyProducts(page, t);
      const ritual = page.getByTestId('myproducts-ritual');
      await ritual.getByText(t('profile:sr.evening'), { exact: true }).click();
      await expect(card(page, 'myproducts-ritual', PID.serum)).toContainText('Hydra Calm Serum');
      await expect(ritual.getByText('Use your own mineral SPF 30+ as the last morning step.')).toHaveCount(0);
      await ritual.getByText(t('profile:sr.morning'), { exact: true }).click();
      await expect(ritual.getByText('Use your own mineral SPF 30+ as the last morning step.')).toBeVisible();
      await expect(card(page, 'myproducts-ritual', PID.serum)).toHaveCount(0);
    });
  });

  test.describe('product card', () => {
    test('photo + price + shop link: photo URL, ILS price and a Buy button', async ({ page, t, mock }) => {
      await openMyProducts(page, t);
      const c = card(page, 'myproducts-ritual', PID.moisturizer);
      await expect(c.getByTestId(`product-photo-${PID.moisturizer}`)).toBeVisible();
      // The photo URL is the public photo route with the cache-busting version of the product.
      const src = await photoSrc(page, PID.moisturizer);
      expect(src).toContain(`/api/catalogue/products/${PID.moisturizer}/photo?v=1700000000002`);
      await expect.poll(() => mock.callsTo('GET', `/api/catalogue/products/${PID.moisturizer}/photo`).length).toBeGreaterThan(0);
      await expect(c.getByTestId(`product-price-${PID.moisturizer}`)).toHaveText(ils('en', 24));
      await expect(c.getByTestId(`product-buy-${PID.moisturizer}`)).toContainText(t('products:card.buy'));
    });

    test('price but no shop link: price shown, no Buy button', async ({ page, t }) => {
      await openMyProducts(page, t);
      const c = card(page, 'myproducts-ritual', PID.cleanser);
      await expect(c.getByTestId(`product-price-${PID.cleanser}`)).toHaveText(ils('en', 18));
      await expect(c.getByTestId(`product-photo-${PID.cleanser}`)).toBeVisible();
      await expect(c.getByTestId(`product-buy-${PID.cleanser}`)).toHaveCount(0);
    });

    test('no photo, no price, no link: a text-only card with the name', async ({ page, t }) => {
      await openMyProducts(page, t);
      await page.getByTestId('myproducts-ritual').getByText(t('profile:sr.evening'), { exact: true }).click();
      const c = card(page, 'myproducts-ritual', PID.serum);
      await expect(c).toContainText('Hydra Calm Serum');
      await expect(c.getByTestId(`product-photo-${PID.serum}`)).toHaveCount(0);
      await expect(c.getByTestId(`product-price-${PID.serum}`)).toHaveCount(0);
      await expect(c.getByTestId(`product-buy-${PID.serum}`)).toHaveCount(0);
    });

    test('Buy opens the shop link in a new window', async ({ page, t, context, mock }) => {
      await openMyProducts(page, t);
      // Same idea as the booking "Pay now" test: wait for the new page, then check its URL. The shop
      // host (shop.e2e.test) is answered by the mock, so it loads and is not a blocked host.
      const [popup] = await Promise.all([
        context.waitForEvent('page'),
        card(page, 'myproducts-ritual', PID.moisturizer).getByTestId(`product-buy-${PID.moisturizer}`).click(),
      ]);
      await popup.waitForLoadState();
      expect(popup.url()).toBe(SHOP_URL);
      expect(mock.blockedHosts()).toEqual([]);
      await popup.close();
    });

    test('an archived product shows "No longer available" and never a Buy button', async ({ page, t, mock }) => {
      // Evening step 2 becomes the archived product (the fixture catalogue returns it with
      // archived: true although it still has a shop link and a price).
      mock.set({ analysis: variant((a) => { a.srProducts.pm[1].sr_product_id = PID.archived; a.srProducts.pm[1].sr_product_name = 'Retired Calming Toner'; }) });
      await openMyProducts(page, t);
      await page.getByTestId('myproducts-ritual').getByText(t('profile:sr.evening'), { exact: true }).click();
      const c = card(page, 'myproducts-ritual', PID.archived);
      await expect(c).toContainText('Retired Calming Toner');
      await expect(c).toContainText(t('products:card.unavailable'));
      await expect(c.getByTestId(`product-buy-${PID.archived}`)).toHaveCount(0);
    });
  });

  test('replace section: "Instead of ..." with the reason and the recommended product card', async ({ page, t }) => {
    await openMyProducts(page, t);
    const section = page.getByTestId('myproducts-replace');
    await expect(section).toContainText(t('products:replace.title'));
    await expect(section).toContainText(t('products:replace.instead', { from: 'Foaming cleanser' }));
    await expect(section).toContainText('The current one leaves skin tight.');
    // The replacement is the item's to_product_id (the cleanser).
    await expect(card(page, 'myproducts-replace', PID.cleanser)).toContainText('Gentle Gel Cleanser');
  });

  test('replace section is hidden when the audit has no replace items', async ({ page, t, mock }) => {
    mock.set({ analysis: variant((a) => { a.productAudit.replace = []; }) });
    await openMyProducts(page, t);
    await expect(page.getByTestId('myproducts-ritual')).toBeVisible();
    await expect(page.getByTestId('myproducts-replace')).toHaveCount(0);
  });

  test('shelf section lists the identified products with their status reason', async ({ page, t }) => {
    await openMyProducts(page, t);
    const section = page.getByTestId('myproducts-shelf');
    await expect(section).toContainText(t('profile:shelf.title'));
    await expect(section).toContainText(`Acme ${MIDDLE_DOT} Foaming Cleanser`);
    await expect(section).toContainText('Sulfates are too harsh for your barrier.');
  });

  test('shelf section is hidden without a shelf analysis', async ({ page, t, mock }) => {
    mock.set({ analysis: variant((a) => { a.shelfAnalysis = null; }) });
    await openMyProducts(page, t);
    await expect(page.getByTestId('myproducts-ritual')).toBeVisible();
    await expect(page.getByTestId('myproducts-shelf')).toHaveCount(0);
  });

  test.describe('other options (market picks)', () => {
    test('shows the AI market picks (moved here from Profile); the picks are fetched once, authed', async ({ page, t, mock }) => {
      await openMyProducts(page, t);
      const section = page.getByTestId('myproducts-other-options');
      await expect(section).toContainText(t('products:otherOptions.title'));
      await expect(section).toContainText(t('products:otherOptions.hint'));
      // One pick per replace / add item from PRODUCT_RECS: the price comes from the mock.
      for (const price of ['$18', '$24', '$32']) await expect(section.getByText(price, { exact: true })).toBeVisible();
      await expect(section).toContainText('Ceramide Moisturizing Cream');
      expect(mock.callsTo('POST', '/api/ai/product-recommendations')).toHaveLength(1);
      expect(mock.lastCall('POST', '/api/ai/product-recommendations').authed).toBe(true);
    });

    test('is hidden when there are no market picks', async ({ page, t, mock }) => {
      mock.override('POST', '/api/ai/product-recommendations', 200, { replace: [], add: [] });
      await openMyProducts(page, t);
      await expect(page.getByTestId('myproducts-ritual')).toBeVisible();
      await expect(page.getByTestId('myproducts-other-options')).toHaveCount(0);
    });
  });

  test('product audit: remove / add / keep tabs switch the items (no replace tab here)', async ({ page, t }) => {
    await openMyProducts(page, t);
    const audit = page.getByTestId('myproducts-audit');
    const tabs = {
      remove: t('profile:audit.remove', { count: 1 }),
      add: t('profile:audit.add', { count: 2 }),
      keep: t('profile:audit.keep', { count: 1 }),
    };
    for (const label of Object.values(tabs)) await expect(audit.getByText(label, { exact: true })).toBeVisible();
    // Replace items are shown in their own section, so the audit has no Replace tab.
    await expect(audit.getByText(t('profile:audit.replace', { count: 1 }), { exact: true })).toHaveCount(0);

    // Remove (default tab).
    await expect(audit.getByText('Physical scrubs damage a stressed barrier.')).toBeVisible();
    // Add: two items with their priority.
    await audit.getByText(tabs.add, { exact: true }).click();
    await expect(audit.getByText('Ceramide moisturizer', { exact: true })).toBeVisible();
    await expect(audit.getByText(t('profile:audit.priority.essential'), { exact: true })).toBeVisible();
    await expect(audit.getByText('Physical scrubs damage a stressed barrier.')).toHaveCount(0);
    // Keep.
    await audit.getByText(tabs.keep, { exact: true }).click();
    await expect(audit.getByText('Gentle and effective, keep using it every morning.')).toBeVisible();
  });

  test('catalogue fetch failure: text-only cards still show the product names', async ({ page, t, mock }) => {
    mock.override('GET', '/api/catalogue/products', 500, { error: 'boom' });
    await openMyProducts(page, t);
    // Names come from the saved analysis, so the ritual is still readable.
    await expect(card(page, 'myproducts-ritual', PID.cleanser)).toContainText('Gentle Gel Cleanser');
    await expect(card(page, 'myproducts-ritual', PID.moisturizer)).toContainText('Barrier Repair Cream');
    // No catalogue data means no photo, no price and no Buy button anywhere.
    await expect(page.locator('[data-testid^="product-photo-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="product-price-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="product-buy-"]')).toHaveCount(0);
    expect(mock.callsTo('GET', '/api/catalogue/products').length).toBeGreaterThan(0);
  });
});

test.describe('empty state', () => {
  test('an analysis with no SR products and no replace items shows the empty state', async ({ page, t, mock }) => {
    mock.set({ analysis: variant((a) => { a.srProducts = null; a.productAudit.replace = []; }) });
    await openMyProducts(page, t);
    const empty = page.getByTestId('myproducts-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(t('products:empty.title'));
    await expect(empty).toContainText(t('products:empty.body'));
    await expect(page.getByTestId('myproducts-ritual')).toHaveCount(0);
    await expect(page.getByTestId('myproducts-replace')).toHaveCount(0);
    // No ids to ask for: the catalogue endpoint (which answers 400 on an empty list) is never called.
    expect(mock.callsTo('GET', '/api/catalogue/products')).toHaveLength(0);
  });
});

// The same screen in Hebrew (RTL), like e2e/hebrew.spec.js: html dir/lang follow the language and the
// labels come from the Hebrew locale. Product names and the analysis text stay as stored (English).
test.describe('Hebrew (RTL)', () => {
  test.use({ lang: 'he' });

  test('the screen renders in Hebrew with ILS prices, RTL direction and the same cards', async ({ page }) => {
    const t = makeT('he');
    await openMyProducts(page, t);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    for (const id of ['myproducts-ritual', 'myproducts-replace', 'myproducts-shelf', 'myproducts-other-options', 'myproducts-audit']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    // Hebrew labels (a missing Hebrew key would fall back to English here, so assert they differ).
    const replaceTitle = t('products:replace.title');
    expect(replaceTitle).not.toBe(makeT('en')('products:replace.title'));
    await expect(page.getByTestId('myproducts-replace')).toContainText(replaceTitle);
    await expect(page.getByTestId('myproducts-replace')).toContainText(t('products:replace.instead', { from: 'Foaming cleanser' }));
    await expect(page.getByTestId('myproducts-ritual').getByText(t('profile:sr.evening'), { exact: true })).toBeVisible();
    // The card keeps its data; the price uses the Hebrew currency format.
    const c = card(page, 'myproducts-ritual', PID.moisturizer);
    await expect(c).toContainText('Barrier Repair Cream');
    await expect(c.getByTestId(`product-price-${PID.moisturizer}`)).toHaveText(ils('he', 24));
    await expect(c.getByTestId(`product-buy-${PID.moisturizer}`)).toContainText(t('products:card.buy'));
  });
});

// Guard so the fixture catalogue and the ids used above cannot drift apart silently.
test('fixture sanity: the catalogue fixture covers the cases these tests rely on', async () => {
  const by = Object.fromEntries(CATALOGUE.map((p) => [p.id, p]));
  expect(by[PID.moisturizer]).toMatchObject({ hasPhoto: true, price: 24, archived: false });
  expect(by[PID.moisturizer].shopUrl).toBe(SHOP_URL);
  expect(by[PID.cleanser]).toMatchObject({ hasPhoto: true, price: 18, shopUrl: null });
  expect(by[PID.serum]).toMatchObject({ hasPhoto: false, price: null, shopUrl: null });
  expect(by[PID.archived].archived).toBe(true);
  expect(by[PID.archived].shopUrl).toMatch(/^https:\/\//);
});
