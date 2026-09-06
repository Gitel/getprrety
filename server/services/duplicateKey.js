// E11000 is raised by whichever unique index actually collided — not necessarily email.
// The auth routes used to map every duplicate-key error to "Email already registered",
// which is how a googleId_1 collision reached users as an email conflict on an address
// they had never used, and why the real cause stayed hidden. Ask which index it was.
function isDuplicateEmail(err) {
  if (err?.code !== 11000) return false;
  if (err.keyPattern) return Boolean(err.keyPattern.email);
  // Older drivers omit keyPattern, but the message still names the index, e.g.
  // "E11000 duplicate key error collection: getprrety.users index: email_1 dup key".
  // Anything that names no index at all stays false: guessing "email" is what caused
  // the original misdiagnosis.
  return /index:\s*email_1\b/.test(String(err.message || ''));
}

module.exports = { isDuplicateEmail };
