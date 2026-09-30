import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import i18n from './i18n';

const SETTINGS_KEY = 'ritualReminderSettings';
const IDS_KEY = 'ritualReminderNotificationIds';
const CHANNEL_ID = 'ritual-reminders';

export const supportsNotifications = () => Capacitor.isNativePlatform();

// The channel name/description are the texts Android shows in its notification settings. They are
// read with i18n.t HERE (inside the function, never at module level) so they use the language that
// is active when the reminders are scheduled. Calling createChannel again with the same id updates
// the name and description of the existing channel.
async function ensureChannel() {
  if (Capacitor.getPlatform() !== 'android') return;
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: i18n.t('notifications:channelName'),
    description: i18n.t('notifications:channelDescription'),
    importance: 3,
    visibility: 1,
    sound: 'default',
  });
}

export async function getNotificationPermission() {
  if (!supportsNotifications()) return false;
  const permission = await LocalNotifications.checkPermissions();
  return permission.display === 'granted';
}

export async function requestNotificationPermission() {
  if (!supportsNotifications()) return false;
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return true;
  const requested = await LocalNotifications.requestPermissions();
  return requested.display === 'granted';
}

export async function loadReminderSchedule() {
  const [{ value }, granted] = await Promise.all([
    Preferences.get({ key: SETTINGS_KEY }),
    getNotificationPermission().catch(() => false),
  ]);
  return { granted, settings: value ? JSON.parse(value) : null };
}

export async function saveReminderSchedule(settings) {
  if (!supportsNotifications()) {
    throw new Error('Ritual reminders are available in the iOS and Android apps.');
  }
  if (!await getNotificationPermission()) {
    throw new Error('Notification permission is not enabled.');
  }

  await ensureChannel();
  const { value: rawIds } = await Preferences.get({ key: IDS_KEY });
  const oldIds = JSON.parse(rawIds || '[]');
  if (oldIds.length) {
    await LocalNotifications.cancel({ notifications: oldIds.map(id => ({ id })) }).catch(() => {});
  }

  const notifications = [];
  // Notification titles/bodies are translated now, at scheduling time, in the current language
  // (the OS shows exactly this text later; it cannot be translated when it fires).
  const schedules = [
    { enabled: settings.amOn, time: settings.amTime, days: settings.amDays, idBase: 1000, title: i18n.t('notifications:morningTitle'), body: i18n.t('notifications:morningBody') },
    { enabled: settings.pmOn, time: settings.pmTime, days: settings.pmDays, idBase: 2000, title: i18n.t('notifications:eveningTitle'), body: i18n.t('notifications:eveningBody') },
  ];

  for (const reminder of schedules) {
    if (!reminder.enabled) continue;
    const [hour, minute] = reminder.time.split(':').map(Number);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new Error('A reminder time is invalid.');
    }
    for (const day of reminder.days) {
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      notifications.push({
        id: reminder.idBase + day,
        title: reminder.title,
        body: reminder.body,
        channelId: Capacitor.getPlatform() === 'android' ? CHANNEL_ID : undefined,
        schedule: { on: { weekday: day + 1, hour, minute }, repeats: true },
      });
    }
  }

  if (notifications.length) await LocalNotifications.schedule({ notifications });
  const ids = notifications.map(notification => notification.id);
  await Promise.all([
    Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(settings) }),
    Preferences.set({ key: IDS_KEY, value: JSON.stringify(ids) }),
  ]);
  return ids.length;
}

// Schedules the saved reminders again so their texts follow the CURRENT language. The language
// switch in the side menu calls this after changing the language (already-scheduled notifications
// keep the text they were created with, so they must be replaced).
// Does nothing (returns false) on the web, when no reminders are saved or switched on, or when
// notification permission is off. It never throws: a failure must not break a language switch.
// Returns true when the reminders were scheduled again.
export async function rescheduleReminders() {
  try {
    if (!supportsNotifications()) return false;
    const { granted, settings } = await loadReminderSchedule();
    if (!granted || !settings || !(settings.amOn || settings.pmOn)) return false;
    await saveReminderSchedule(settings);
    return true;
  } catch {
    return false;
  }
}
