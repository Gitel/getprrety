// Starts everything the admin e2e suite needs, then stays alive until Playwright stops it.
//
// Steps: (1) in-memory MongoDB, (2) real seed script against it, (3) real server/index.js.
//
// SAFETY (why no real DB or secret can be touched):
//  - The DB is mongodb-memory-server: a throwaway local mongod, deleted on exit.
//  - We pass MONGODB_URI explicitly. dotenv NEVER overrides variables that are already set,
//    so even if a .env file were read, our memory URI wins.
//  - The server runs with cwd = e2e-admin/, which has no .env file. server/index.js calls
//    require('dotenv').config(), which reads .env from the CURRENT WORKING DIRECTORY, so
//    nothing real is loaded. (The seed script loads server/.env by absolute path; that is
//    harmless only because MONGODB_URI is already set, see above.)
//  - The child server gets an ALLOW-LIST environment (only what Node needs to run, plus the
//    explicit test values below). Nothing else from the developer's shell, such as cloud
//    credentials or API keys, is passed on. Note: libraries that read credential FILES in the
//    home directory (e.g. ~/.aws) are not stopped by this; the real guarantee against a real
//    database is that MONGODB_URI is set explicitly to the in-memory server.
//  - The service keys that the server reads (email, face analysis, AI) are set to '' too.
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseEnv } from './baseEnv.js';
import { PORT, ADMIN_EMAIL, ADMIN_SESSION_SECRET, JWT_SECRET } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminDir = path.resolve(here, '..');
const repoRoot = path.resolve(adminDir, '..');
const serverDir = path.join(repoRoot, 'server');

let mongod = null;
let serverChild = null;
let shuttingDown = false;

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (serverChild && !serverChild.killed) serverChild.kill(); } catch { /* ignore */ }
  try { if (mongod) await mongod.stop(); } catch { /* ignore */ }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('gp_admin_e2e');

  // Sanity check only: the URI above comes from MongoMemoryServer itself, so this cannot fail
  // today; it just catches a future edit that swaps in some other URI.
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(uri)) {
    throw new Error('Refusing to run: MONGODB_URI is not a local memory-server URI');
  }

  // Let specs find the URI (the seed re-run spec needs the same DB).
  mkdirSync(path.join(adminDir, '.tmp'), { recursive: true });
  writeFileSync(path.join(adminDir, '.tmp', 'db.json'), JSON.stringify({ uri }));

  // Allow-list env (see support/baseEnv.js): nothing else from the developer's shell is passed on.
  const env = {
    ...baseEnv(),
    MONGODB_URI: uri,
    NODE_ENV: 'test',
    PORT: String(PORT),
    ADMIN_SESSION_SECRET,
    JWT_SECRET,
    ADMIN_ALLOWED_EMAILS: ADMIN_EMAIL,
    // Blank anything that could reach a real service.
    POSTMARK_API_KEY: '',
    POSTMARK_SENDER_ADDRESS: '',
    POSTMARK_MESSAGE_STREAM: '',
    CLINIC_NOTIFY_TO: '',
    PERFECTCORP_API_KEY: '',
    PERFECTCORP_BASE_URL: '',
    ANTHROPIC_API_KEY: '',
    RAILWAY_API_URL: '',
    GOOGLE_CLIENT_IDS: '',
    ADMIN_GOOGLE_CLIENT_ID: '',
    // The browser sends `Origin: http://127.0.0.1:<port>` on every form POST, and the
    // server's CORS check (server/index.js) rejects any origin that is not listed. In
    // production the admin's own site is in CORS_ORIGINS; here the test server's own
    // address plays that role (and nothing else is allowed).
    CORS_ORIGINS: `http://127.0.0.1:${PORT}`,
  };

  // Seed the catalogue with the REAL seed script (fails loudly on a non-zero exit).
  const seed = spawnSync(process.execPath, [path.join(serverDir, 'scripts', 'seedCatalogue.js')], {
    env, cwd: adminDir, stdio: 'inherit',
  });
  if (seed.status !== 0) throw new Error(`seedCatalogue.js failed (exit ${seed.status})`);

  // Start the REAL server. cwd = e2e-admin (no .env there), see header comment.
  serverChild = spawn(process.execPath, [path.join(serverDir, 'index.js')], {
    env, cwd: adminDir, stdio: 'inherit',
  });
  serverChild.on('exit', code => { if (!shuttingDown) shutdown(code || 1); });
}

main().catch(err => {
  console.error(err);
  shutdown(1);
});
