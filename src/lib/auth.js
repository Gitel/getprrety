import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'gp_token';

export async function storeToken(token) {
  await Preferences.set({ key: TOKEN_KEY, value: token });
}

export async function getToken() {
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  return value;
}

export async function removeToken() {
  await Preferences.remove({ key: TOKEN_KEY });
}
