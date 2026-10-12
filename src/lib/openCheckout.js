// Opens the Shopify checkout page for a booking that is waiting for payment.
//  - Native app (Capacitor): the in-app browser (@capacitor/browser).
//  - Web: a small popup window; if the browser blocks it (returns null) we navigate this tab.
// `deps` exists only so tests can inject fakes.
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

export async function openCheckout(url, deps = {}) {
  const { platform = Capacitor, browser = Browser, win = globalThis.window } = deps;
  if (!url) return;

  if (platform.isNativePlatform()) {
    await browser.open({ url });
    return;
  }

  const popup = win.open(url, 'gp_checkout', 'popup,width=500,height=760');
  // A blocked popup gives null: fall back to a normal navigation so the user can still pay.
  if (!popup) win.location.assign(url);
}
