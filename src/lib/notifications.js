import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const SETTINGS_KEY = 'ritualReminderSettings';
const IDS_KEY = 'ritualReminderNotificationIds';
const CHANNEL_ID = 'ritual-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Ritual reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
  });
}

export async function getNotificationPermission() {
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted;
}

export async function requestNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function loadReminderSchedule() {
  const [raw, granted] = await Promise.all([
    AsyncStorage.getItem(SETTINGS_KEY),
    getNotificationPermission().catch(() => false),
  ]);
  return { granted, settings: raw ? JSON.parse(raw) : null };
}

export async function saveReminderSchedule(settings) {
  const granted = await getNotificationPermission();
  if (!granted) throw new Error('Notification permission is not enabled.');

  await ensureChannel();
  const oldIds = JSON.parse((await AsyncStorage.getItem(IDS_KEY)) || '[]');
  await Promise.all(oldIds.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));

  const ids = [];
  const schedules = [
    { enabled: settings.amOn, time: settings.amTime, days: settings.amDays, title: 'Morning ritual', body: 'A gentle reminder for your morning skincare ritual.' },
    { enabled: settings.pmOn, time: settings.pmTime, days: settings.pmDays, title: 'Evening ritual', body: 'Time to wind down with your evening skincare ritual.' },
  ];

  try {
    for (const schedule of schedules) {
      if (!schedule.enabled) continue;
      const [hour, minute] = schedule.time.split(':').map(Number);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new Error('A reminder time is invalid.');
      }
      for (const day of schedule.days) {
        if (!Number.isInteger(day) || day < 0 || day > 6) continue;
        const id = await Notifications.scheduleNotificationAsync({
          content: { title: schedule.title, body: schedule.body, sound: 'default' },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: day + 1,
            hour,
            minute,
            channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
          },
        });
        ids.push(id);
      }
    }
  } catch (err) {
    await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
    throw err;
  }

  await Promise.all([
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)),
    AsyncStorage.setItem(IDS_KEY, JSON.stringify(ids)),
  ]);
  return ids.length;
}
