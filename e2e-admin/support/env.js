// Shared constants for the admin e2e suite (used by startServer.js and the specs).
// These are FAKE test values; nothing here is a real secret.
export const PORT = Number(process.env.E2E_ADMIN_PORT || 4300);
export const ADMIN_EMAIL = 'e2e-admin@example.test';
export const ADMIN_SESSION_SECRET = 'e2e-admin-test-session-secret-not-real';
export const JWT_SECRET = 'e2e-admin-test-jwt-secret-not-real';
