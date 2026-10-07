// Renders every /admin template with realistic data. Nothing else in the repo exercises
// the EJS files, and CI runs no tests, so a typo in a template only shows up as a 500 in
// production. This catches it at `npm test` time instead.
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, 'admin');

function render(name, data) {
  return ejs.renderFile(path.join(VIEWS, `${name}.ejs`), {
    admin: { email: 'admin@example.com' },
    csrfToken: 'TEST_CSRF_TOKEN',
    ...data,
  });
}

const analysis = {
  _id: '64b000000000000000000001',
  userId: '64b0000000000000000000aa',
  eraId: 'barrier_healing',
  era: { id: 'barrier_healing', name: 'Barrier Healing Era', tagline: 'Tag' },
  skinAnalysis: 'Summary',
  keyInsights: ['One'],
  routine: { am: [{ name: 'Cleanse', description: 'Gently' }], pm: [] },
  affirmation: 'I glow',
  quizAnswers: { name: 'Ada', allergies: ['none'] },
  createdAt: new Date('2026-09-01T10:00:00Z'),
  clinicNotifiedAt: null,
};

test('customer page renders and embeds the CSRF token in the resend form', async () => {
  const html = await render('customer', {
    analysis,
    user: { _id: analysis.userId, email: 'ada@example.com', firstName: 'Ada' },
    imageIds: [],
    resent: false,
    dashboardUrl: 'https://x/admin/customer/1',
    // Everything routes/admin.js GET /customer/:id passes to the view.
    eras: Object.values(require('../services/eras').ERAS),
    shelfStatuses: require('../services/analysisFields').SHELF_STATUSES,
    isLatest: true,
    notice: null,
  });
  expect(html).toContain('name="_csrf" value="TEST_CSRF_TOKEN"');
});

test('clients list renders', async () => {
  const html = await render('list', {
    rows: [{ ...analysis, userId: { firstName: 'Ada', email: 'ada@example.com' } }],
    mailProblem: null,
  });
  expect(html).toContain('Ada');
});

test('login page renders without a session', async () => {
  const html = await render('login', { googleClientId: 'cid', error: null, admin: undefined });
  expect(html).toContain('GetPretty Admin');
});

test('admins page: built-in admins are protected, others removable, never yourself', async () => {
  const html = await render('admins', {
    builtIn: ['owner@example.com'],
    dbAdmins: [
      { _id: 'a1', email: 'helper@example.com', addedBy: 'owner@example.com' },
      { _id: 'a2', email: 'admin@example.com', addedBy: 'owner@example.com' }, // the viewer
    ],
    notice: { text: 'Admin added.' },
  });
  expect(html).toContain('owner@example.com');
  expect(html).toContain('protected');
  expect(html).toContain('/admin/admins/a1/remove');
  expect(html).not.toContain('/admin/admins/a2/remove');
  expect(html).toContain('Admin added.');
  expect(html).not.toMatch(/<form[^>]*\son\w+=/); // CSP blocks inline handlers
});

test('admins page escapes a hostile email inside the confirm text', async () => {
  const html = await render('admins', {
    builtIn: [],
    dbAdmins: [{ _id: 'a1', email: `x"><script>alert(1)</script>'@example.com`, addedBy: 'o@example.com' }],
    notice: null,
  });
  expect(html).not.toContain('<script>alert(1)');
  expect(html).toContain('&lt;script&gt;');
});

test('audit page renders entries and the per-user filter', async () => {
  const html = await render('audit', {
    entries: [{
      createdAt: new Date(), adminEmail: 'admin@example.com', action: 'routine_updated',
      userId: '64b0000000000000000000aa', analysisId: '64b000000000000000000001', fields: ['routine'],
    }],
    filterUserId: '64b0000000000000000000aa',
  });
  expect(html).toContain('routine updated');
  expect(html).toContain('show all');
});

test('audit page renders when empty', async () => {
  const html = await render('audit', { entries: [], filterUserId: null });
  expect(html).toContain('No admin actions recorded yet.');
});

test('users page lists accounts, escapes the search term and keeps it in page links', async () => {
  const html = await render('users', {
    list: {
      q: '<b>ada</b>',
      total: 120,
      page: 2,
      pages: 3,
      users: [
        { _id: 'u1', firstName: 'Ada', email: 'ada@example.com', googleId: 'g', createdAt: new Date(), analyses: { count: 2, latestEraName: 'Glow Building Era' } },
        { _id: 'u2', email: 'noquiz@example.com', createdAt: new Date(), analyses: { count: 0 } },
      ],
    },
  });
  expect(html).toContain('/admin/users/u1');
  expect(html).toContain('(no name)');
  expect(html).toContain('Glow Building Era');
  expect(html).not.toContain('<b>ada</b>');
  expect(html).toContain('q=%3Cb%3Eada%3C%2Fb%3E');
  expect(html).toContain('Page 2 of 3');
});

test('user page renders every section and marks the newest analysis as shown in app', async () => {
  const html = await render('user', {
    user: { _id: 'u1', firstName: 'Ada', email: 'ada@example.com', createdAt: new Date() },
    analyses: [
      { _id: 'a2', eraId: 'glow_building', era: { name: 'Glow Building Era' }, createdAt: new Date() },
      { _id: 'a1', eraId: 'barrier_healing', createdAt: new Date() },
    ],
    checkIns: [{ mood: 'Glowing', createdAt: new Date() }],
    products: [{ uploadId: 'up1', productName: 'Serum', createdAt: new Date() }],
    activity: [{ event: 'app_open', location: { city: 'Tel Aviv', country: 'IL' }, createdAt: new Date() }],
    notice: null,
  });
  expect(html.match(/shown in app/g)).toHaveLength(1);
  expect(html).toContain('/admin/customer/a2');
  expect(html).toContain('/admin/users/u1/image/up1');
  expect(html).toContain('Glowing');
  expect(html).toContain('app open');
  expect(html).toContain('Tel Aviv, IL');
});

test('user page renders a signup with no quiz and no activity', async () => {
  const html = await render('user', {
    user: { _id: 'u1', email: 'new@example.com' },
    analyses: [], checkIns: [], products: [], activity: [], notice: null,
  });
  expect(html).toContain('has not finished the quiz');
});

test('user page profile form is pre-filled and carries the CSRF token', async () => {
  const html = await render('user', {
    user: { _id: 'u1', firstName: 'Ada', email: 'ada@example.com', googleId: 'g1', skincareTiming: 'night', city: 'Haifa', country: 'IL' },
    analyses: [], checkIns: [], products: [], activity: [],
    notice: { text: 'Profile saved.' },
  });
  expect(html).toContain('action="/admin/users/u1/profile"');
  expect(html).toContain('name="_csrf" value="TEST_CSRF_TOKEN"');
  expect(html).toContain('value="Haifa"');
  expect(html).toMatch(/<option value="night" selected>/);
  expect(html).toContain('signs in with Google');
  expect(html).toContain('Profile saved.');
});

describe('customer page editors', () => {
  const { ERAS } = require('../services/eras');
  const base = {
    analysis,
    user: { _id: analysis.userId, email: 'ada@example.com' },
    imageIds: [], resent: false, dashboardUrl: 'x', eras: Object.values(ERAS), notice: null,
    shelfStatuses: require('../services/analysisFields').SHELF_STATUSES,
  };

  test('the Skin Era editor offers only the fixed eras, current one selected', async () => {
    const html = await render('customer', { ...base, isLatest: true });
    expect(html).toContain('action="/admin/customer/64b000000000000000000001/edit/fields"');
    expect((html.match(/<option value="/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(html).toMatch(/<option value="barrier_healing" selected>/);
    expect(html).toContain('data-list="keyInsights"');
    expect(html).toContain("it is what the app shows");
  });

  test('an older reading warns that edits will not appear in the app', async () => {
    const html = await render('customer', { ...base, isLatest: false });
    expect(html).toContain('older skin reading');
  });

  test('a legacy era id outside the list is shown but must be replaced', async () => {
    const html = await render('customer', { ...base, isLatest: true, analysis: { ...analysis, eraId: 'legacy_era' } });
    expect(html).toContain('Current: legacy_era (not in the list, pick one)');
  });

  test('editors never use inline event handlers (CSP blocks them)', async () => {
    const html = await render('customer', { ...base, isLatest: true });
    expect(html).not.toMatch(/<[a-z]+[^>]*\son(click|submit|change)=/i);
  });
});

describe('customer page: picks, SR Ritual and shelf editors', () => {
  const { ERAS } = require('../services/eras');
  const { SHELF_STATUSES } = require('../services/analysisFields');
  const full = {
    ...analysis,
    productAudit: { add: [{ product: 'SPF', priority: 'essential' }, { product: 'Serum' }], replace: [] },
    productRecs: { add: [{ index: 1, rec: { name: 'Niacinamide', url: 'https://x.example/n' } }], replace: [] },
    productRecsEditedAt: new Date('2026-09-20T08:00:00Z'),
    srProducts: { bundle_note: 'Bundle', era_hero_product: { sr_product_name: 'Hero' }, am: [{ routine_category: 'Cleanse', key_actives_matched: ['a', 'b'] }], pm: [] },
    shelfAnalysis: { identified_products: [{ product_name: 'Scrub', status: 'conflicting' }] },
  };
  const base = {
    user: { _id: analysis.userId, email: 'a@x.co' }, imageIds: [], resent: false, dashboardUrl: 'x',
    eras: Object.values(ERAS), shelfStatuses: SHELF_STATUSES, isLatest: true, notice: null,
  };

  test('a saved admin pick is pre-filled on the item it belongs to (by index)', async () => {
    const html = await render('customer', { ...base, analysis: full });
    const serumRow = html.slice(html.indexOf('value="Serum"'));
    expect(serumRow.slice(0, 2500)).toContain('value="Niacinamide"');
    const spfRow = html.slice(html.indexOf('value="SPF"'), html.indexOf('value="Serum"'));
    expect(spfRow).not.toContain('Niacinamide');
    expect(html).toContain('set by an admin');
  });

  test('without admin picks the page says the AI generates them', async () => {
    const html = await render('customer', { ...base, analysis: { ...full, productRecs: null } });
    expect(html).toContain('generates product picks with AI');
  });

  test('SR Ritual and shelf editors render existing data', async () => {
    const html = await render('customer', { ...base, analysis: full });
    expect(html).toContain('action="/admin/customer/64b000000000000000000001/edit/sr"');
    expect(html).toContain('value="a, b"');
    expect(html).toContain('action="/admin/customer/64b000000000000000000001/edit/shelf"');
    expect(html).toMatch(/<option value="conflicting" selected>/);
  });

  test('a reading with no SR Ritual or shelf still renders empty editors', async () => {
    const html = await render('customer', { ...base, analysis: { ...analysis, srProducts: null, shelfAnalysis: null } });
    expect(html).toContain('has no SR Ritual yet');
    expect(html).toContain('has no shelf analysis yet');
  });
});

describe('messaging views', () => {
  test('the nav shows the unread-replies badge only when there are some', async () => {
    const withBadge = await render('audit', { entries: [], filterUserId: null, unreadReplies: 3 });
    expect(withBadge).toMatch(/Inbox<span class="badge"[^>]*>3<\/span>/);
    const without = await render('audit', { entries: [], filterUserId: null, unreadReplies: 0 });
    expect(without).not.toContain('class="badge"');
  });

  test('user page shows the thread (with admin names), new replies, and the send form', async () => {
    const html = await render('user', {
      user: { _id: 'u1', firstName: 'Ada', email: 'ada@example.com' },
      analyses: [], checkIns: [], products: [], activity: [], notice: null, maxMessage: 2000,
      thread: [
        { from: 'admin', adminEmail: 'lu@clinic.com', body: 'Hi Ada <3', createdAt: new Date(), readAt: new Date() },
        { from: 'user', body: 'Thanks!\nSee you', createdAt: new Date(), readAt: null },
      ],
    });
    expect(html).toContain('id="messages"');
    expect(html).toContain('lu@clinic.com');
    expect(html).toContain('read by user');
    expect(html).toContain('Hi Ada &lt;3');
    expect(html).toContain('>new</span>');
    expect(html).toContain('action="/admin/users/u1/messages"');
  });

  test('inbox lists users with unread replies, and handles a deleted user', async () => {
    const html = await render('inbox', {
      rows: [
        { userId: 'u1', unread: 2, latestAt: new Date(), latestBody: 'x'.repeat(300), user: { firstName: 'Ada', email: 'ada@example.com' } },
        { userId: 'u2', unread: 1, latestAt: new Date(), latestBody: 'hello', user: null },
      ],
    });
    expect(html).toContain('/admin/users/u1#messages');
    expect(html).toContain('...');
    expect(html).toContain('Deleted user');
  });

  test('empty inbox', async () => {
    expect(await render('inbox', { rows: [] })).toContain('No unread replies.');
  });
});

test('user page has a delete card that requires typing the email', async () => {
  const html = await render('user', {
    user: { _id: 'u1', email: 'ada@example.com' },
    analyses: [], checkIns: [], products: [], activity: [], thread: [], notice: null,
  });
  expect(html).toContain('action="/admin/users/u1/delete"');
  expect(html).toContain('name="confirmEmail"');
  expect(html).toContain('data-confirm="Permanently delete ada@example.com');
});

test('users page shows the "deleted" notice after a delete', async () => {
  const html = await render('users', {
    list: { q: '', total: 0, page: 1, pages: 1, users: [] },
    notice: { text: 'The account and all of its data were permanently deleted.' },
  });
  expect(html).toContain('permanently deleted');
});

describe('catalogue pages', () => {
  const labels = require('../services/catalogueProducts');
  const listData = {
    categoryLabels: labels.CATEGORY_LABELS,
    useLabels: labels.USE_LABELS,
    pregnancyLabels: labels.PREGNANCY_LABELS,
  };
  const product = {
    _id: '64b0000000000000000000c1',
    slug: 'herbal-mousse',
    name: 'Herbal Mousse',
    category: 'face_serums',
    use: 'professional',
    pregnancy: 'avoid',
    hasPhoto: true,
    archived: false,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-02T10:00:00Z'),
  };
  const values = {
    name: 'Herbal Mousse', category: 'face_serums', use: 'professional', pregnancy: 'avoid',
    keyActives: 'A\nB', ingredients: 'Water', strengths: 'S', suitableFor: 'T',
  };
  const editData = { ...listData, product, values, notice: null };

  test('list renders rows, thumbnail, professional pill, archived label and nav state', async () => {
    const html = await render('catalogue', {
      ...listData,
      notice: null,
      products: [
        product,
        { ...product, _id: '64b0000000000000000000c2', slug: 'old-one', name: 'Old One', use: 'home', hasPhoto: false, archived: true },
      ],
    });
    expect(html).toContain('>Products</h1>'); // visible text only; styling may change
    expect(html).toContain('href="/admin/catalogue/new"');
    expect(html).toContain('data-product-slug="herbal-mousse"');
    expect(html).toContain('src="/admin/catalogue/64b0000000000000000000c1/photo"');
    expect(html).not.toContain('/admin/catalogue/64b0000000000000000000c2/photo');
    expect(html).toContain('Professional only');
    expect(html).toContain('Face serums');
    expect(html).toContain('Avoid in pregnancy');
    expect(html.match(/Archived/g)).toHaveLength(1); // only the archived row
    expect(html).toMatch(/<a href="\/admin\/catalogue" class="active">Products<\/a>/);
    expect(html).not.toMatch(/<(a|tr|td|img|form|button)[^>]*\son\w+=/);
  });

  test('list escapes a hostile product name', async () => {
    const html = await render('catalogue', {
      ...listData, notice: null, products: [{ ...product, name: '<script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  test('nav shows Products between Users and Inbox', async () => {
    const html = await render('catalogue', { ...listData, notice: null, products: [] });
    expect(html.indexOf('>Users<')).toBeLessThan(html.indexOf('>Products<'));
    expect(html.indexOf('>Products<')).toBeLessThan(html.indexOf('>Inbox'));
  });

  test('edit page: fields, slug, photo form, archive form, CSRF in every POST form', async () => {
    const html = await render('catalogueProduct', editData);
    expect(html).toContain('<code class="slug">herbal-mousse</code>');
    expect(html).toContain('<option value="professional" selected>Professional only</option>');
    expect(html).toContain('A\nB</textarea>');
    expect(html).toContain('One item per line.');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('accept="image/jpeg,image/png"');
    expect(html).toContain('JPEG or PNG, up to 2 MB.');
    expect(html).toContain('>Upload photo<');
    expect(html).toContain('<form method="post" action="/admin/catalogue/64b0000000000000000000c1/archive" data-confirm=');
    expect(html).toContain('>Archive<');
    const forms = html.match(/<form method="post"/g).length;
    expect(html.match(/name="_csrf" value="TEST_CSRF_TOKEN"/g)).toHaveLength(forms);
    expect(forms).toBe(3);
    expect(html).not.toMatch(/<form[^>]*\son\w+=/);
  });

  test('archived product shows Restore instead of Archive', async () => {
    const html = await render('catalogueProduct', { ...editData, product: { ...product, archived: true } });
    expect(html).toContain('/admin/catalogue/64b0000000000000000000c1/restore');
    expect(html).not.toContain('/archive"');
    expect(html).toContain('Archived');
  });

  test('new page has no slug, photo or archive forms', async () => {
    const html = await render('catalogueProduct', {
      ...listData, product: null, notice: null,
      values: { name: '', category: '', use: '', pregnancy: '', keyActives: '', ingredients: '', strengths: '', suitableFor: '' },
    });
    expect(html).toContain('action="/admin/catalogue"');
    expect(html).toContain('>Create product<');
    expect(html).not.toContain('class="slug"');
    expect(html).not.toContain('multipart/form-data');
    expect(html.match(/name="_csrf"/g)).toHaveLength(1);
  });

  test('hostile name and typed values are escaped; error notice is shown on re-render', async () => {
    const evil = `"><script>alert(1)</script>`;
    const html = await render('catalogueProduct', {
      ...editData,
      values: { ...values, name: evil, strengths: '<b>typed</b>' },
      notice: { text: 'A product with this name already exists.', error: true },
    });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;b&gt;typed&lt;/b&gt;');
    expect(html).toContain('<div class="notice error">A product with this name already exists.</div>');
  });

  test('audit page links catalogue entries to the product', async () => {
    const html = await render('audit', {
      entries: [{
        createdAt: new Date(), adminEmail: 'admin@example.com', action: 'catalogue_product_updated',
        catalogueProductId: '64b0000000000000000000c1', fields: ['name'],
      }],
      filterUserId: null,
    });
    expect(html).toContain('catalogue product updated');
    expect(html).toContain('<a href="/admin/catalogue/64b0000000000000000000c1">product</a>');
  });
});
