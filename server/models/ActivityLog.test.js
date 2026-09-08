const ActivityLog = require('./ActivityLog');

// Kept in sync by hand with the logActivity() call sites in the app:
//   src/context/AppContext.js, src/screens/LoginScreen.jsx, src/screens/HomeScreen.jsx,
//   src/screens/SettingsScreen.jsx, src/screens/SignUpScreen.jsx, src/screens/LoadingScreen.jsx
// An event the client emits but the enum rejects fails validation, 500s, and is
// swallowed by logActivity's catch — it records nothing, forever, in silence.
const EVENTS_THE_CLIENT_EMITS = [
  'app_open',
  'login',
  'signup',
  'logout',
  'checkin',
  'analysis_save_failed',
];

test('the event enum accepts every event the client emits', () => {
  const allowed = ActivityLog.schema.path('event').enumValues;
  for (const event of EVENTS_THE_CLIENT_EMITS) {
    expect(allowed).toContain(event);
  }
});

test('an unknown event still fails validation', () => {
  const doc = new ActivityLog({ userId: '507f1f77bcf86cd799439011', event: 'not_a_real_event' });
  const err = doc.validateSync();
  expect(err.errors.event).toBeDefined();
});
