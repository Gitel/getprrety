import * as Location from 'expo-location';

// Returns { lat, lng, city, region, country } or null if unavailable/denied.
// Never throws — location is best-effort.
export async function getLocation() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5000,
      mayShowUserSettingsDialog: false,
    });

    const [place] = await Location.reverseGeocodeAsync({
      latitude:  pos.coords.latitude,
      longitude: pos.coords.longitude,
    });

    return {
      lat:     pos.coords.latitude,
      lng:     pos.coords.longitude,
      city:    place?.city    || place?.district || null,
      region:  place?.region  || null,
      country: place?.country || null,
    };
  } catch {
    return null;
  }
}
