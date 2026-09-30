import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Linking } from 'react-native'; // mapped to src/lib/testStubs/reactNative.js
import { openInAppBrowser } from './inAppBrowser';

jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: jest.fn() } }));
jest.mock('@capacitor/browser', () => ({ Browser: { open: jest.fn() } }));

const URL_OK = 'https://clinic.test/book';
let openURL;

beforeEach(() => {
  Capacitor.isNativePlatform.mockReset().mockReturnValue(false);
  Browser.open.mockReset().mockResolvedValue(undefined);
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => {
  openURL.mockRestore();
});

describe.each([true, false])('refuses non-https input (native=%s)', native => {
  test.each([
    ['http', 'http://clinic.test/book'],
    ['javascript', 'javascript:alert(1)'],
    ['malformed', 'not a url'],
    ['empty', ''],
    ['whitespace', '   '],
    ['undefined', undefined],
    ['null', null],
  ])('%s', async (_name, value) => {
    Capacitor.isNativePlatform.mockReturnValue(native);
    await expect(openInAppBrowser(value)).resolves.toBe(false);
    expect(Browser.open).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });
});

test('native: opens with Browser.open({ url })', async () => {
  Capacitor.isNativePlatform.mockReturnValue(true);
  await expect(openInAppBrowser(URL_OK)).resolves.toBe(true);
  expect(Browser.open).toHaveBeenCalledWith({ url: URL_OK });
  expect(openURL).not.toHaveBeenCalled();
});

test('native: rejection resolves false', async () => {
  Capacitor.isNativePlatform.mockReturnValue(true);
  Browser.open.mockRejectedValue(new Error('no browser'));
  await expect(openInAppBrowser(URL_OK)).resolves.toBe(false);
});

test('web: Linking.openURL is called synchronously, before any await', () => {
  const promise = openInAppBrowser(URL_OK);
  // No await between the call and this assertion: the open already happened.
  expect(openURL).toHaveBeenCalledWith(URL_OK);
  expect(Browser.open).not.toHaveBeenCalled();
  return expect(promise).resolves.toBe(true);
});

test('web: rejection resolves false', async () => {
  openURL.mockRejectedValue(new Error('blocked'));
  await expect(openInAppBrowser(URL_OK)).resolves.toBe(false);
});

test('web: a synchronous throw resolves false', async () => {
  openURL.mockImplementation(() => {
    throw new Error('boom');
  });
  await expect(openInAppBrowser(URL_OK)).resolves.toBe(false);
});
