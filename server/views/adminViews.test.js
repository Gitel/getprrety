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

test('customer page identifies a new Anthropic analysis', async () => {
  const html = await render('customer', {
    analysis: { ...analysis, source: 'anthropic' },
    user: { _id: analysis.userId, email: 'ada@example.com', firstName: 'Ada' },
    imageIds: [], resent: false, dashboardUrl: 'x', eras: Object.values(require('../services/eras').ERAS),
    shelfStatuses: require('../services/analysisFields').SHELF_STATUSES, isLatest: true, notice: null,
  });
  expect(html).toContain('Analysis provider: Anthropic');
});

test('clients list renders', async () => {
  const html = await render('list', {
    rows: [{ ...analysis, userId: { firstName: 'Ada', email: 'ada@example.com' } }],
    mailProblem: null,
  });
  expect(html).toContain('Ada');
});

test('clients list labels Anthropic analyses', async () => {
  const html = await render('list', {
    rows: [{ ...analysis, source: 'anthropic', userId: { firstName: 'Ada', email: 'ada@example.com' } }],
    mailProblem: null,
  });
  expect(html).toContain('Anthropic');
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

describe('booking pages', () => {
  const row = {
    id: '64b0000000000000000000b1', userId: '64b0000000000000000000aa',
    userEmail: 'evil"><script>x</script>@example.com', date: '2026-10-08', time: '10:00',
    note: '<b>note</b>', status: 'confirmed',
  };

  test('upcoming tab lists rows with a CSRF-protected cancel form, escaped', async () => {
    const html = await render('bookings', { tab: 'upcoming', rows: [row] });
    expect(html).toContain('<td class="when">2026-10-08 10:00</td>');
    expect(html).toContain('action="/admin/bookings/64b0000000000000000000b1/cancel"');
    expect(html).toContain('name="_csrf" value="TEST_CSRF_TOKEN"');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;b&gt;note&lt;/b&gt;');
  });

  test('past tab has no cancel button and an empty tab says so', async () => {
    expect(await render('bookings', { tab: 'past', rows: [row] })).not.toContain('Cancel booking');
    expect(await render('bookings', { tab: 'cancelled', rows: [] })).toContain('<p class="muted">No bookings.</p>');
  });

  test('settings page renders typed values and the invalid notice', async () => {
    const days = Array.from({ length: 7 }, () => ({ enabled: false, open: '', close: '' }));
    days[0] = { enabled: true, open: '25:99', close: '18:00' };
    const html = await render('bookingSettings', {
      form: { enabled: true, slotMinutes: 30, bufferMinutes: '15', leadHours: 12, horizonDays: 30, days },
      weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      slotOptions: [15, 20, 30, 45, 60],
      notice: { text: 'Please check the settings', error: true },
    });
    expect(html).toContain('Time zone: Asia/Jerusalem');
    expect(html).toContain('name="day0_open" value="25:99"');
    expect(html).toContain('name="bufferMinutes" min="0" max="60" value="15"');
    expect(html).toContain('<div class="notice error">Please check the settings</div>');
  });
});

describe('paid booking statuses and attention tab', () => {
  const base = {
    userId: '64b0000000000000000000aa', userEmail: 'a@example.com', date: '2026-10-08', time: '10:00',
    note: '', holdExpiresAt: null, needsAttention: null, calendarSynced: true,
    payment: { status: 'none', amount: null, currency: null, providerRef: null, paidAt: null },
  };

  test('awaiting payment shows the hold end in clinic time and still has a cancel button', async () => {
    // 07:15 UTC on 2026-10-08 is 10:15 in Asia/Jerusalem (UTC+3 in October).
    const row = { ...base, id: 'b1', status: 'pending_payment', holdExpiresAt: '2026-10-08T07:15:00.000Z' };
    const html = await render('bookings', { tab: 'upcoming', rows: [row] });
    expect(html).toContain('<td class="status">Awaiting payment until 10:15</td>');
    expect(html).toContain('Cancel booking');
    expect(html).toContain('If it was paid, refund it in Shopify.');
  });

  test('confirmed row shows the payment and Calendar pending only while the event is missing', async () => {
    const paid = { status: 'paid', amount: 150, currency: 'ILS', providerRef: '9001', paidAt: new Date() };
    const pending = await render('bookings', {
      tab: 'upcoming', rows: [{ ...base, id: 'b2', status: 'confirmed', calendarSynced: false, payment: paid }],
    });
    expect(pending).toContain('Confirmed');
    expect(pending).toContain('Calendar pending');
    expect(pending).toContain('<td class="payment">Paid 150 ILS - order 9001</td>');
    const synced = await render('bookings', { tab: 'upcoming', rows: [{ ...base, id: 'b3', status: 'confirmed' }] });
    expect(synced).not.toContain('Calendar pending');
    expect(synced).toContain('<td class="payment">-</td>');
  });

  test('attention tab: link, labels for every attention code, expired and cancelled words', async () => {
    const rows = [
      { ...base, id: 'a1', status: 'expired', needsAttention: 'paid_slot_lost' },
      { ...base, id: 'a2', status: 'cancelled', needsAttention: 'paid_after_cancel' },
      { ...base, id: 'a3', status: 'confirmed', needsAttention: 'paid_extra' },
    ];
    const html = await render('bookings', { tab: 'attention', rows });
    expect(html).toContain('>Needs attention</a>');
    expect(html).toContain('<td class="attention">Paid, slot lost');
    expect(html).toContain('<td class="attention">Paid after cancel');
    expect(html).toContain('<td class="attention">Extra payment');
    // Each flagged row has a CSRF-protected Mark handled form posting to its own id.
    expect(html).toContain('action="/admin/bookings/a1/handled"');
    expect(html).toContain('name="_csrf" value="TEST_CSRF_TOKEN"');
    expect((html.match(/Mark handled/g) || []).length).toBe(3);
    expect(html).toContain('<td class="status">Expired</td>');
    expect(html).toContain('<td class="status">Cancelled</td>');
    // Only the Upcoming tab has the cancel column.
    expect(html).not.toContain('Cancel booking');
  });

  test('Mark handled appears only on the attention tab', async () => {
    const row = { ...base, id: 'a1', status: 'confirmed', needsAttention: 'paid_extra' };
    expect(await render('bookings', { tab: 'past', rows: [row] })).not.toContain('Mark handled');
  });

  test('user page bookings card uses the same status words', async () => {
    const html = await render('user', {
      user: { _id: 'u1', email: 'ada@example.com' },
      analyses: [], checkIns: [], products: [], activity: [], thread: [], notice: null,
      bookings: [{ ...base, id: 'b1', status: 'pending_payment', holdExpiresAt: '2026-10-08T07:15:00.000Z' }],
    });
    expect(html).toContain('Awaiting payment until 10:15');
  });
});

describe('sign-in link card and invites', () => {
  const userData = {
    user: { _id: 'u1', email: 'ada@example.com' },
    analyses: [], checkIns: [], products: [], activity: [], thread: [], notice: null,
  };
  const linkRow = over => ({
    id: 'l1', purpose: 'signin', status: 'active', link: 'https://x.test/#signin=TOKEN',
    createdAt: new Date(), createdByAdminEmail: 'admin@example.com', expiresAt: new Date('2026-10-15T09:30:00Z'),
    usedAt: null, lastSentAt: null, sendCount: 0, lastSendError: null, invite: null, ...over,
  });

  test('no links yet: create button only', async () => {
    const html = await render('user', { ...userData, signinLinks: [] });
    expect(html).toContain('<section class="card" id="signin-link">');
    expect(html).toContain('action="/admin/users/u1/signin-link"');
    expect(html).toContain('Create new link');
    expect(html).not.toContain('id="signin-link-url"');
    expect(html).not.toContain('id="signin-link-history"');
  });

  test('active link: readonly input, copy button, resend form, history item', async () => {
    const html = await render('user', {
      ...userData, signinLinks: [linkRow({ sendCount: 2, lastSendError: 'send_failed' })],
    });
    expect(html).toContain('id="signin-link-url" readonly value="https://x.test/#signin=TOKEN"');
    expect(html).toContain('data-copy="#signin-link-url"');
    expect(html).toContain('Active until 2026-10-15 12:30');
    expect(html).toContain('action="/admin/users/u1/signin-link/resend"');
    expect(html).toContain('<li data-link-id="l1">');
    expect(html).toContain('sent 2 times');
    expect(html).toContain('last error: send_failed');
  });

  test('used and replaced links show no URL and the right status words', async () => {
    const html = await render('user', {
      ...userData,
      signinLinks: [linkRow({ id: 'l2', status: 'used', link: null }), linkRow({ id: 'l3', status: 'revoked', link: null })],
    });
    expect(html).not.toContain('id="signin-link-url"');
    expect(html).toContain('Used,');
    expect(html).toContain('Replaced,');
  });

  test('users page: invite form with the contract fields, empty pending list', async () => {
    const html = await render('users', { list: { q: '', total: 0, page: 1, pages: 1, users: [] }, invites: [] });
    expect(html).toContain('id="invite"');
    expect(html).toContain('Invite a new customer');
    expect(html).toContain('action="/admin/invites"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="firstName"');
    expect(html).toContain('<option value="he" selected>Hebrew</option>');
    expect(html).toContain('Send invite');
    expect(html).toContain('<p class="muted">No pending invites.</p>');
  });

  test('users page: pending invite row with link, copy and resend; hostile values escaped', async () => {
    const html = await render('users', {
      list: { q: '', total: 0, page: 1, pages: 1, users: [] },
      invites: [linkRow({
        id: 'i1', purpose: 'invite',
        invite: { email: 'x"><script>y</script>@example.com', firstName: '<b>Ina</b>', language: 'en' },
      })],
    });
    expect(html).toContain('<tr data-invite-id="i1">');
    expect(html).toContain('data-copy="#invite-url-i1"');
    expect(html).toContain('action="/admin/invites/i1/resend"');
    expect(html).toContain('value="https://x.test/#signin=TOKEN"');
    expect(html).not.toContain('<script>y');
    expect(html).not.toContain('<b>Ina</b>');
  });

  test('footer script has the copy handler', async () => {
    const html = await render('audit', { entries: [], filterUserId: null });
    expect(html).toContain('button[data-copy]');
    expect(html).toContain('navigator.clipboard.writeText');
  });
});

describe('customer page: catalogue pickers, score reading and safety editors', () => {
  const PEEL = 'a'.repeat(24);
  const pickerProducts = [{ _id: PEEL, name: 'One Step Peel' }, { _id: 'b'.repeat(24), name: 'Other Cream' }];
  const reading = {
    startHere: { title: 'Start here', body: 'Body' },
    signals: [{ key: 'barrier', potential: 90, weeks: '6 weeks', driver: 'Dry', why: 'Why', lever: 'Lever', shelf: null, product: null }],
  };
  const renderCustomer = extra => render('customer', {
    analysis: {
      ...analysis,
      srProducts: {
        bundle_note: 'n',
        era_hero_product: { sr_product_name: 'One Step Peel', sr_product_id: PEEL, hero_reason: 'r' },
        am: [
          { routine_category: 'Cleanse', sr_product_name: 'Old Typed Serum', sr_product_id: 'admin-entered' }, // legacy
          { routine_category: 'Protect', sr_product_name: '', sr_product_id: null, no_match_note: 'Any SPF' },
        ],
        pm: [],
      },
      productAudit: { keep: [], remove: [], add: [], replace: [{ from: 'Toner', to: 'Old text only', reason: 'r' }] },
      safetyFlags: ['Flag one', 'Flag <b>two</b>'], checkInPrompts: ['Prompt one'],
    },
    user: { _id: analysis.userId, email: 'ada@example.com', firstName: 'Ada' },
    imageIds: [], resent: false, dashboardUrl: 'https://x/admin/customer/1',
    eras: Object.values(require('../services/eras').ERAS),
    shelfStatuses: require('../services/analysisFields').SHELF_STATUSES,
    isLatest: true, notice: null, pickerProducts, ...extra,
  });

  test('pickers list "No product" first, then catalogue products, with the stored one selected', async () => {
    const html = await renderCustomer({ reading: null });
    expect(html).toContain('data-product-picker');
    expect(html).toContain('data-path="srProducts.era_hero_product.sr_product_id"');
    expect(html).toMatch(new RegExp(`<option value="${PEEL}" selected>One Step Peel</option>`));
    expect(html).toContain('<option value="">No product</option>');
    for (const path of ['sr_product_id', 'to_product_id', 'sr_substitute_product_id', 'shelfAnalysis.transition_plan.first_sr_purchase_product_id']) {
      expect(html).toContain(`data-product-picker data-path="${path}"`);
    }
    // The old free-text name inputs are gone.
    expect(html).not.toContain('<input type="text" data-path="sr_product_name"');
  });

  test('a legacy product is shown read-only and kept through a "keep:" option', async () => {
    const html = await renderCustomer({ reading: null });
    expect(html).toContain('class="legacy-product');
    expect(html).toContain('Old Typed Serum');
    expect(html).toContain('<option value="keep:admin-entered" selected>');
    expect(html).toContain('Old text only'); // replace "to" without an id is legacy too
    expect(html).toContain('<option value="keep:" selected>');
  });

  test('reading card renders only with a reading; safety card always, escaped, one item per line', async () => {
    const withReading = await renderCustomer({ reading, readingScores: { barrier: 55 } });
    expect(withReading).toContain('id="reading"');
    expect(withReading).toContain('/admin/customer/64b000000000000000000001/edit/reading');
    expect(withReading).toContain('data-path="startHere.title"');
    expect(withReading).toContain('<input type="hidden" data-path="key" value="barrier">');
    expect(withReading).toContain("today's score 55");
    expect(withReading).toContain('id="safety"');
    expect(withReading).toContain('Flag one\nFlag &lt;b&gt;two&lt;/b&gt;');
    expect(withReading).toContain('data-split="&#10;"');

    const without = await renderCustomer({ reading: null });
    expect(without).not.toContain('id="reading"');
    expect(without).toContain('id="safety"');
  });

  test('renders without the new locals (older callers)', async () => {
    const html = await renderCustomer({ pickerProducts: undefined });
    expect(html).toContain('data-product-picker');
  });
});

// AI settings pages (routes/adminAi.js). Editable and read-only variants of the edit page.
describe('AI settings pages', () => {
  const { DEFAULTS, BOUNDS } = require('../services/aiConfig/aiConfig');
  const editData = (over = {}) => ({
    key: 'skin_analysis',
    def: DEFAULTS.skin_analysis,
    bounds: BOUNDS,
    form: { guidance: 'Be <kind>', timeoutSec: 90, maxOutputTokens: 8000, maxCostUsd: 0.25, note: '' },
    errors: {},
    live: {},
    activeLabel: 'Built-in default',
    versions: [{
      id: '64b0000000000000000000c1', guidance: 'g', limits: { timeoutSec: 60, maxOutputTokens: 4000, maxCostUsd: 0.1 },
      note: 'first', createdBy: 'a@example.com', restoredFrom: null, createdAt: new Date('2026-10-01T10:00:00Z'),
    }],
    sampleCases: [{ id: 'en_basic', label: 'English' }],
    canEdit: true,
    notice: null,
    ...over,
  });

  test('list page renders one row per key with the live version label', async () => {
    const html = await render('ai', { rows: [{ key: 'skin_analysis', title: 'Skin analysis', activeLabel: 'Built-in default' }] });
    expect(html).toContain('data-ai-key="skin_analysis"');
    expect(html).toContain('href="/admin/ai/skin_analysis"');
    expect(html).toContain('Built-in default');
    expect(html).toContain('href="/admin/ai" class="active"');
  });

  test('editable edit page has the form, csrf, test button, restore forms and escapes values', async () => {
    const html = await render('aiEdit', editData());
    expect(html).toContain('id="ai-config-form"');
    expect(html).toContain('name="_csrf" value="TEST_CSRF_TOKEN"');
    expect(html).toContain('data-action="publish"');
    expect(html).toContain('data-action="test"');
    expect(html).toContain('data-restore-default');
    expect(html).toContain('data-version-id="64b0000000000000000000c1"');
    expect(html).toContain('Be &lt;kind&gt;');
    expect(html).toContain('$0.10-0.20');
  });

  test('AI test button recognizes missing Anthropic configuration', async () => {
    const html = await render('aiEdit', editData());
    expect(html).toContain("r.data.code === 'ANTHROPIC_NOT_CONFIGURED'");
    expect(html).toContain('AI is not configured on this server.');
  });

  test('field errors are shown next to the field', async () => {
    const html = await render('aiEdit', editData({ errors: { timeoutSec: 'Enter a whole number from 20 to 90.' } }));
    expect(html).toContain('data-field="timeoutSec"');
  });

  test('read-only variant has readonly inputs and no publish, test or restore controls', async () => {
    const html = await render('aiEdit', editData({
      canEdit: false, key: 'market_picks', def: DEFAULTS.market_picks,
      notice: { text: 'Only built-in admins can change AI settings.', error: true },
    }));
    expect(html).toContain('name="guidance" rows="10" readonly>');
    expect(html).not.toContain('data-action="publish"');
    expect(html).not.toContain('data-action="test"');
    expect(html).not.toContain('data-action="restore"');
    expect(html).not.toContain('$0.10-0.20');
    expect(html).toContain('Only built-in admins can change AI settings.');
  });
});
