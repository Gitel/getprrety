import { defineConfig } from '@playwright/test';

// This area uses an Express fixture with fake storage. It never starts MongoDB or the app jobs.
export default defineConfig({
  testDir: 'e2e-admin', testMatch: 'api-keys.spec.js', workers: 1, fullyParallel: false,
  reporter: 'list', retries: 0,
  use: { browserName: 'chromium', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
});
