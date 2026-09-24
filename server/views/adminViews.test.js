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
