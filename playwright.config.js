// Playwright end-to-end config. Behaviour tests only (no screenshots).
// Run with:  npm run test:e2e   (see e2e/README.md)
import { defineConfig } from '@playwright/test';

// Each agent/run can use its own port; the build goes to a folder named after the port so
// parallel runs never share (or overwrite) a build.
const port = Number(process.env.E2E_PORT || 4173);
const buildDir = `.e2e-build/${port}`;

// The mobile viewport shared by both browsers.
const mobile = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  workers: Number(process.env.E2E_WORKERS || 2),

  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: 'UTC',
    locale: 'en-US',
    // Reduced motion by default makes animations instant (e.g. the side menu slide, the score dial
    // count-up). NOTE: it must live in contextOptions; a top-level `reducedMotion` is silently ignored.
    // Specs that need real animation override it with
    // test.use({ contextOptions: { reducedMotion: 'no-preference' } }).
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'mobile-chromium', use: { browserName: 'chromium', ...mobile } },
    { name: 'mobile-webkit', use: { browserName: 'webkit', ...mobile } },
  ],

  // Build the app once, then serve the build. ALL six VITE_* values are set here on purpose:
  // process env wins over any local .env, so no real value can leak into the test build.
  // The API origin must match MOCK_API_ORIGIN in e2e/support/mock-api.js.
  webServer: {
    command: `npx vite build --outDir ${buildDir} --emptyOutDir && npx vite preview --outDir ${buildDir} --port ${port} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_API_URL: 'http://api.e2e.test',
      VITE_TERMS_URL: 'https://example.test/terms',
      VITE_PRIVACY_URL: 'https://example.test/privacy',
      VITE_CONSENT_VERSION: 'v1',
      VITE_GOOGLE_WEB_CLIENT_ID: 'e2e-dummy',
    },
  },
});
