import { openCheckout } from './openCheckout';

const URL_ = 'https://shop.example/cart/1:1';
const web = { isNativePlatform: () => false };
const native = { isNativePlatform: () => true };

test('web: opens a named popup', async () => {
  const win = { open: jest.fn(() => ({})), location: { assign: jest.fn() } };
  await openCheckout(URL_, { platform: web, win });
  expect(win.open).toHaveBeenCalledWith(URL_, 'gp_checkout', 'popup,width=500,height=760');
  expect(win.location.assign).not.toHaveBeenCalled();
});

test('web: a blocked popup falls back to navigating this tab', async () => {
  const win = { open: jest.fn(() => null), location: { assign: jest.fn() } };
  await openCheckout(URL_, { platform: web, win });
  expect(win.location.assign).toHaveBeenCalledWith(URL_);
});

test('native: uses the in-app browser, not window.open', async () => {
  const win = { open: jest.fn(), location: { assign: jest.fn() } };
  const browser = { open: jest.fn(() => Promise.resolve()) };
  await openCheckout(URL_, { platform: native, browser, win });
  expect(browser.open).toHaveBeenCalledWith({ url: URL_ });
  expect(win.open).not.toHaveBeenCalled();
});

test('no url: does nothing', async () => {
  const win = { open: jest.fn(), location: { assign: jest.fn() } };
  await openCheckout(null, { platform: web, win });
  expect(win.open).not.toHaveBeenCalled();
});
