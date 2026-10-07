// Playwright config for the SERVER-RENDERED ADMIN dashboard (/admin/*).
// Separate from playwright.config.js (the mobile app suite), which stays untouched.
// Run with:  npm run test:e2e:admin
//
// Safety: webServer runs e2e-admin/support/startServer.js, which starts an IN-MEMORY MongoDB
// and the real server against it. No real database or secret is ever used.
import { defineConfig } from '@playwright/test';

// Own port range (4300+) so it never clashes with the mobile suite (4173-4199).
const port = Number(process.env.E2E_ADMIN_PORT || 4300);

export default defineConfig({
  testDir: 'e2e-admin',
  testMatch: '**/*.spec.js',
  // One shared in-memory DB and specs mutate data, so run one worker, in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',

  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    // Desktop Chromium only (the dashboard is a desktop tool).
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
  },

  webServer: {
    command: 'node e2e-admin/support/startServer.js',
    // /health is a public route in server/index.js (no login needed).
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    // First run downloads the MongoDB binary (can take minutes).
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_ADMIN_PORT: String(port) },
  },
});
