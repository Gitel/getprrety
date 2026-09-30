# End-to-end tests (Playwright)

Behaviour tests that drive the real built web app at a phone viewport (390x844) in Chromium and
WebKit. The backend is fully mocked; no real network or database is touched.

## Run

```
npm run test:e2e                              # both projects
npm run test:e2e -- --project=mobile-webkit   # one browser
npm run test:e2e -- e2e/smoke.spec.js         # one file
E2E_PORT=4180 E2E_WORKERS=4 npm run test:e2e  # other port / more workers
```

Playwright builds the app (all six `VITE_*` values are set in `playwright.config.js`, so a local
`.env` never leaks in) into `.e2e-build/<port>` and serves it. Use a different `E2E_PORT` when
several runs happen at the same time.

## Writing a spec

```js
import { test, expect } from './support/test.js';

test.use({ signedIn: true });                       // options: signedIn (false), lang ('en' | 'he')

test('Home shows the unread badge', async ({ page, mock, t }) => {
  mock.set({ unread: 3 });                          // override mock state BEFORE navigating
  await page.goto('/');
  await expect(page.getByLabel(t('home:messages.unread', { count: 3 }))).toBeVisible();
  expect(mock.callsTo('GET', '/api/messages/unread-count')).toHaveLength(1);
});
```

Reduced motion is ON for every test (set in `playwright.config.js` via `contextOptions`), so animations
are instant. A spec that needs real animation overrides it:
`test.use({ contextOptions: { reducedMotion: 'no-preference' } })`. A top-level `reducedMotion`
option is silently ignored by Playwright; `smoke.spec.js` guards the default.

## Fixtures

- `t('ns:path.to.key', { var })` - text from `src/locales/<lang>/<ns>.json` (`{{var}}` and
  `count` plurals supported). Falls back to English, throws if the key does not exist.
- `mock` - the mocked backend:
  - `mock.set({ analysis, messages, unread, ticks, user })` - override state (`analysis: null` -> no
    saved analysis, 404). Defaults come from `support/fixtures-data.js` (user Dana, Barrier Healing
    Era, 3 messages with 1 unread, one AM tick). `user` feeds login, `GET /api/auth/me` and
    `/api/profile`; `PATCH /api/profile` merges into it; signup replaces it with a new-user shape
    (no `skincareTiming`, `language: null`). `FIRST_TIME_USER` (Dana without `skincareTiming`) is
    exported from the fixtures: `mock.set({ analysis: null, user: FIRST_TIME_USER })`.
  - `mock.override(method, path, status, body)` - force the answer of one endpoint (persistent, the
    call is still logged in `mock.calls`); `mock.clearOverride(method, path)` removes it.
  - `POST /api/messages/read` marks clinic messages read and sets `unread` to 0, like the server.
  - `mock.calls`, `mock.callsTo(method, path)`, `mock.lastCall(method, path)` - call log with
    `{ method, path, query, body, authed }`.
  - `mock.state` - current state (for example messages after the user sent one).
  - `mock.holdAnalysis()` / `await mock.releaseAnalysis()` - hold the Railway `/analyze-skin`
    request open, then let it fail (the app then uses its built-in fallback plan).
- Navigation helpers, `support/nav.js`: `openMenu`, `tapMenuItem(page, t, key)`, `backButton`,
  `openHome`, `openProfileFromHome`, `openMessages(page, t, unread = 1)`, `openSettings`,
  `openSignUp`. Each waits for its target screen.
- Quiz helpers, `support/quiz.js`: `NAME`, `nameVars`, `walkQuizToLoading`,
  `expectProfileAfterQuiz`, `finishOnboardingToHome`.
- Options `signedIn` and `lang` seed the token / stored language before the app starts.
- The clock is fixed at 2026-09-29 09:00 UTC (and keeps running), `Math.random` is seeded and
  geolocation is denied.

An automatic teardown fails the test on uncaught page errors and on API calls the mock does not
know (they get a 404 and are reported). Blocked external hosts are attached as a warning.

## Rules

- Assert behaviour only. No screenshots or pixel comparisons.
- Take all UI text from `t()`; never hard-code a string that lives in a locale file.
- No fixed sleeps. Use auto-waiting assertions (`await expect(...).toBeVisible()`).
- Add new endpoints to `support/mock-api.js` (same shape as `server/routes/*`).
