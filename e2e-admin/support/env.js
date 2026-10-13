// Shared constants for the admin e2e suite (used by startServer.js and the specs).
// These are FAKE test values; nothing here is a real secret.
export const PORT = Number(process.env.E2E_ADMIN_PORT || 4300);
export const ADMIN_EMAIL = 'e2e-admin@example.test';
export const ADMIN_SESSION_SECRET = 'e2e-admin-test-session-secret-not-real';
export const JWT_SECRET = 'e2e-admin-test-jwt-secret-not-real';
// Fake Shopify values for the paid-booking flow (no real store is ever contacted).
export const SHOPIFY_STORE_URL = 'https://shop.e2e.test';
export const SHOPIFY_CONSULTATION_VARIANT_ID = '12345';
// Secret used to sign the fake `orders/paid` webhooks the specs send.
export const SHOPIFY_WEBHOOK_SECRET = 'e2e-admin-test-shopify-webhook-secret-not-real';
// Policy version the server treats as current (needed when an invite is redeemed with consent).
export const CONSENT_VERSION = 'e2e-consent-v1';
