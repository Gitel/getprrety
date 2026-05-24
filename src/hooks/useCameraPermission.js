import { useCameraPermissions } from 'expo-camera';

export function useCameraPermission() {
  const [permission, requestPermission] = useCameraPermissions();

  async function ensurePermission() {
    if (permission?.granted) return true;
    const result = await requestPermission();
    return result.granted;
  }

  return { granted: permission?.granted ?? false, ensurePermission };
}
