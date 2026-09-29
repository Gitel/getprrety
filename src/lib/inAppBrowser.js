import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Linking } from 'react-native';

// Only well-formed https: URLs are ever opened. Anything else (http:, javascript:,
// garbage, empty) is refused so a bad config value cannot become a link.
function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

// Opens a web page "over" the app. Resolves true when the page was opened, false when
// the URL was refused or the open failed. It never throws.
//
// - Phones (Capacitor native): Browser.open shows Chrome Custom Tabs (Android) or
//   SFSafariViewController (iOS) on top of the app; the user taps Done to come back.
// - Web: Linking.openURL from react-native-web opens a new tab with `noopener`
//   (@capacitor/browser's own web implementation does not add it, so we avoid it).
//
// IMPORTANT for callers: call this straight from the tap handler, before any `await`.
// This function is deliberately not `async`: on the web the tab is opened
// synchronously, before any promise is awaited, so the browser still sees it as a
// direct result of the tap and does not treat it as a blocked popup.
export function openInAppBrowser(url) {
  if (!isHttpsUrl(url)) return Promise.resolve(false);
  const target = url.trim();

  if (Capacitor.isNativePlatform()) {
    return Browser.open({ url: target }).then(
      () => true,
      () => false,
    );
  }

  try {
    // Runs synchronously now; only the resulting promise is awaited by the caller.
    return Promise.resolve(Linking.openURL(target)).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}
