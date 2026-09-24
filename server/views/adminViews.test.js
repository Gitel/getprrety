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
