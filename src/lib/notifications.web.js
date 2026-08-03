import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'ritualReminderSettings';

export async function getNotificationPermission() {
  return false;
}

export async function requestNotificationPermission() {
  return false;
}

export async function loadReminderSchedule() {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return { granted: false, settings: raw ? JSON.parse(raw) : null };
}

export async function saveReminderSchedule() {
  throw new Error('Ritual reminders are available in the iOS and Android apps.');
}
