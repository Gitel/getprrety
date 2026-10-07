// Runs once before the whole jest run. It sets the machine time zone to one that is NOT the
// clinic's (Asia/Jerusalem), so a bug that uses the server's own zone instead of the clinic zone
// (config.timeZone) fails on every developer machine, not only on machines outside Israel.
// (Setting process.env.TZ inside a test file does not work: jest gives each test file its own
// copy of process.env, so the change never reaches Node's Date. This file runs in the real
// process, and the test workers inherit the value.)
module.exports = async () => {
  process.env.TZ = 'America/New_York';
};
