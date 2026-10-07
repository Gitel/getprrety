// The environment variables a Node child process needs (plus Windows basics). Everything else
// in the developer's shell (cloud keys, API tokens, ...) is deliberately NOT passed on.
// Used by startServer.js (the test server) and by the spec that re-runs the seed script.
const ALLOWED = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec',
  'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
];

export function baseEnv() {
  const env = {};
  for (const key of ALLOWED) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
