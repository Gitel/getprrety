// Logs a Playwright browser context into /admin WITHOUT any bypass in production code.
// We sign a normal admin session JWT with the real signSession() and the test secret, and
// set it as the gp_admin cookie. The server accepts it because ADMIN_ALLOWED_EMAILS (set by
// startServer.js) lists this email, so no DB lookup is needed.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_EMAIL, ADMIN_SESSION_SECRET } from './env.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

// adminAuth reads the secret from process.env when signing, so set it first.
process.env.ADMIN_SESSION_SECRET = ADMIN_SESSION_SECRET;
const { signSession, COOKIE_NAME } = require(path.resolve(here, '../../server/services/adminAuth.js'));

// Adds the session cookie to the context; returns the csrf value for forms/CSRF tests.
export async function signIn(context) {
  const token = signSession(ADMIN_EMAIL);
  await context.addCookies([{ name: COOKIE_NAME, value: token, domain: '127.0.0.1', path: '/admin' }]);
  // The JWT payload is the middle part, base64url JSON.
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return { token, csrf: payload.csrf };
}
