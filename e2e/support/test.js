// The `test` and `expect` every spec imports:  import { test, expect } from './support/test.js';
//
// Extra options (set per file with test.use({ ... }) or per project):
//   signedIn  false (default) | true   -> seeds the mock auth token, so the app boots signed in
//   lang      'en' (default)  | 'he'   -> seeds the stored app language
// Extra fixtures:
//   mock      the mocked backend (see mock-api.js): mock.set, mock.calls, mock.callsTo, ...
//   t         translate 'namespace:key' with the app's own locale files (see i18n.js)
// An automatic teardown fails the test on uncaught page errors or unmocked API calls.
import { test as base, expect } from '@playwright/test';
import { createMock, MOCK_API_ORIGIN } from './mock-api.js';
import { TOKEN } from './fixtures-data.js';
import { pageInit, buildStorage, FIXED_ISO } from './page-init.js';
import { makeT } from './i18n.js';

export const test = base.extend({
  signedIn: [false, { option: true }],
  lang: ['en', { option: true }],

  // Auto fixture: installs routing + page init on the context before the test body runs, and
  // checks for problems afterwards.
  mock: [async ({ context, baseURL, signedIn, lang }, use, testInfo) => {
    const mock = createMock({ appOrigin: new URL(baseURL).origin });
    const pageErrors = [];

    await context.route('**/*', mock.router);
    await context.addInitScript(pageInit, {
      fixedIso: FIXED_ISO,
      storage: buildStorage({ signedIn, lang, token: TOKEN }),
    });
    // 'weberror' fires for uncaught exceptions in ANY page of the context (popups too).
    context.on('weberror', webError => pageErrors.push(String(webError.error()?.message ?? webError.error())));

    await use(mock);

    // Teardown: let a held analysis request go so nothing stays pending.
    await mock.releaseAnalysis();

    const blocked = mock.blockedHosts();
    if (blocked.length) {
      // A warning, not a failure: external hosts are blocked on purpose.
      await testInfo.attach('blocked-external-hosts', { body: blocked.join('\n'), contentType: 'text/plain' });
    }
    expect.soft(pageErrors, 'uncaught page errors').toEqual([]);
    expect.soft(mock.unmocked(), `unmocked API calls to ${MOCK_API_ORIGIN}`).toEqual([]);
  }, { auto: true }],

  t: async ({ lang }, use) => { await use(makeT(lang)); },
});

export { expect };
