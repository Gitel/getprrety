// Tests for the translated reminder texts and rescheduleReminders().
// The Capacitor plugins are replaced with fakes, so nothing native runs.
import { rescheduleReminders, saveReminderSchedule } from './notifications';
import i18n from './i18n';

// `platform` and `preferences` are changed per test. jest only allows mock factories to use
// variables whose names start with "mock".
const mockState = { native: true, platform: 'android', prefs: {} };

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockState.native,
    getPlatform: () => mockState.platform,
  },
}));
jest.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: jest.fn(async () => ({ display: 'granted' })),
    requestPermissions: jest.fn(async () => ({ display: 'granted' })),
    createChannel: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    schedule: jest.fn(async () => {}),
  },
}));
jest.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: jest.fn(async ({ key }) => ({ value: mockState.prefs[key] ?? null })),
    set: jest.fn(async ({ key, value }) => { mockState.prefs[key] = value; }),
  },
}));

const { LocalNotifications } = require('@capacitor/local-notifications');

const SETTINGS = {
  amOn: true, pmOn: false, amTime: '08:00', pmTime: '21:00',
  amDays: [1, 2], pmDays: [0],
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockState.native = true;
  mockState.platform = 'android';
  mockState.prefs = {};
  LocalNotifications.checkPermissions.mockResolvedValue({ display: 'granted' });
  await i18n.changeLanguage('en');
});
afterAll(() => i18n.changeLanguage('en'));

describe('saveReminderSchedule texts', () => {
  test('English texts and channel are the same as before translation', async () => {
    await saveReminderSchedule({ ...SETTINGS, pmOn: true });
    expect(LocalNotifications.createChannel).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ritual reminders',
      description: 'Get Pretty skincare ritual reminders',
    }));
    const { notifications } = LocalNotifications.schedule.mock.calls[0][0];
    const am = notifications.find(n => n.id === 1001);
    const pm = notifications.find(n => n.id === 2000);
    expect(am.title).toBe('Morning ritual');
    expect(am.body).toBe('A gentle reminder for your morning skincare ritual.');
    expect(pm.title).toBe('Evening ritual');
    expect(pm.body).toBe('Time to wind down with your evening skincare ritual.');
  });

  test('texts follow the current language at scheduling time', async () => {
    await i18n.changeLanguage('he');
    await saveReminderSchedule(SETTINGS);
    const { notifications } = LocalNotifications.schedule.mock.calls[0][0];
    expect(notifications[0].title).toBe(i18n.t('notifications:morningTitle', { lng: 'he' }));
    expect(notifications[0].title).not.toBe('Morning ritual');
    expect(LocalNotifications.createChannel.mock.calls[0][0].name).not.toBe('Ritual reminders');
  });
});

describe('rescheduleReminders', () => {
  test('does nothing on the web', async () => {
    mockState.native = false;
    mockState.prefs.ritualReminderSettings = JSON.stringify(SETTINGS);
    expect(await rescheduleReminders()).toBe(false);
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });

  test('does nothing when no reminders are saved', async () => {
    expect(await rescheduleReminders()).toBe(false);
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });

  test('does nothing when both reminders are off', async () => {
    mockState.prefs.ritualReminderSettings = JSON.stringify({ ...SETTINGS, amOn: false });
    expect(await rescheduleReminders()).toBe(false);
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });

  test('does nothing when notification permission is off', async () => {
    mockState.prefs.ritualReminderSettings = JSON.stringify(SETTINGS);
    LocalNotifications.checkPermissions.mockResolvedValue({ display: 'denied' });
    expect(await rescheduleReminders()).toBe(false);
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });

  test('schedules the saved reminders again in the new language', async () => {
    mockState.prefs.ritualReminderSettings = JSON.stringify(SETTINGS);
    await i18n.changeLanguage('he');
    expect(await rescheduleReminders()).toBe(true);
    const { notifications } = LocalNotifications.schedule.mock.calls[0][0];
    expect(notifications).toHaveLength(2); // morning on Monday and Tuesday
    expect(notifications[0].title).toBe(i18n.t('notifications:morningTitle', { lng: 'he' }));
    expect(notifications[0].title).not.toBe('Morning ritual');
  });

  test('never throws, even when scheduling fails or the saved data is broken', async () => {
    mockState.prefs.ritualReminderSettings = JSON.stringify(SETTINGS);
    LocalNotifications.schedule.mockRejectedValueOnce(new Error('native failure'));
    await expect(rescheduleReminders()).resolves.toBe(false);
    mockState.prefs.ritualReminderSettings = '{not json';
    await expect(rescheduleReminders()).resolves.toBe(false);
  });
});
