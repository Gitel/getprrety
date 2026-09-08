import { Geolocation } from '@capacitor/geolocation';

// Location is optional. Capacitor uses the native location service in an installed
// app and the browser geolocation implementation on the web.
export async function getLocation() {
  try {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 5000,
    });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      city: null,
      region: null,
      country: null,
    };
  } catch {
    return null;
  }
}
