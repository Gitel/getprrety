jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn() } }));

import { onAppResume, nextAnalysis, keepIfEqual } from './resumeRefresh';

describe('onAppResume', () => {
  test('native: listens to the Capacitor App "resume" event and removes it on cleanup', async () => {
    const remove = jest.fn();
    const app = { addListener: jest.fn(() => Promise.resolve({ remove })) };
    const onResume = jest.fn();
    const stop = onAppResume(onResume, { platform: { isNativePlatform: () => true }, app });

    expect(app.addListener).toHaveBeenCalledWith('resume', expect.any(Function));
    app.addListener.mock.calls[0][1]();
    expect(onResume).toHaveBeenCalledTimes(1);

    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalled();
  });

  test('web: fires only when the page becomes visible, and unsubscribes', () => {
    const listeners = {};
    const doc = {
      visibilityState: 'hidden',
      addEventListener: jest.fn((name, fn) => { listeners[name] = fn; }),
      removeEventListener: jest.fn(),
    };
    const onResume = jest.fn();
    const stop = onAppResume(onResume, { platform: { isNativePlatform: () => false }, doc });

    listeners.visibilitychange(); // still hidden
    expect(onResume).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    listeners.visibilitychange();
    expect(onResume).toHaveBeenCalledTimes(1);

    stop();
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', listeners.visibilitychange);
  });
});

describe('nextAnalysis', () => {
  const fromServer = { _id: 'a1', routine: { am: [{ name: 'Old' }] } };

  test('a server-read analysis is replaced by the fresh server copy (clinic edits)', () => {
    const edited = { _id: 'a1', routine: { am: [{ name: 'Edited by clinic' }] } };
    expect(nextAnalysis(fromServer, edited)).toBe(edited);
  });

  test('a just-finished quiz result (no _id, save maybe in flight) is never overwritten', () => {
    const fresh = { era: { id: 'glow_building' } };
    expect(nextAnalysis(fresh, { _id: 'older', era: { id: 'barrier_healing' } })).toBe(fresh);
  });

  test('no current analysis takes the server one; no server one keeps the current', () => {
    expect(nextAnalysis(null, fromServer)).toBe(fromServer);
    expect(nextAnalysis(fromServer, null)).toBe(fromServer);
  });

  test('identical data keeps the existing object (no needless re-render)', () => {
    expect(nextAnalysis(fromServer, JSON.parse(JSON.stringify(fromServer)))).toBe(fromServer);
  });
});

describe('keepIfEqual', () => {
  test('keeps prev for equal data, takes next otherwise', () => {
    const prev = { id: 1, name: 'Ada' };
    expect(keepIfEqual(prev, { id: 1, name: 'Ada' })).toBe(prev);
    const next = { id: 1, name: 'Eve' };
    expect(keepIfEqual(prev, next)).toBe(next);
  });
});
