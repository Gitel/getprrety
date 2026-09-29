// i18n.js runs in node here (no document). We test the instance and the html-attribute listener
// by faking a minimal `document` before the module is imported.
describe('i18n instance', () => {
  let i18n;
  let currentDir;
  const fakeDocument = { documentElement: { lang: '', dir: '' } };

  beforeAll(() => {
    global.document = fakeDocument;
    jest.isolateModules(() => {
      ({ default: i18n, currentDir } = require('./i18n'));
    });
  });

  afterAll(() => {
    delete global.document;
  });

  test('is ready synchronously, in English', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en');
    expect(i18n.t('back')).toBe('← Back'); // defaultNS is common
    expect(i18n.t('common:loading')).toBe('Loading…');
  });

  test('sets <html lang/dir> for the initial language', () => {
    expect(fakeDocument.documentElement.lang).toBe('en');
    expect(fakeDocument.documentElement.dir).toBe('ltr');
    expect(currentDir()).toBe('ltr');
  });

  test('a language change updates <html lang/dir> and currentDir()', async () => {
    await i18n.changeLanguage('he');
    expect(fakeDocument.documentElement.lang).toBe('he');
    expect(fakeDocument.documentElement.dir).toBe('rtl');
    expect(currentDir()).toBe('rtl');
    expect(i18n.t('common:tryAgain')).not.toBe('Try again'); // Hebrew text is used
    await i18n.changeLanguage('en');
    expect(fakeDocument.documentElement.dir).toBe('ltr');
  });

  test('a missing Hebrew key falls back to English', async () => {
    await i18n.changeLanguage('he');
    expect(i18n.t('common:doesNotExist', 'fallback')).toBe('fallback');
    expect(i18n.exists('common:back', { lng: 'en' })).toBe(true);
    await i18n.changeLanguage('en');
  });

  test('imports safely when there is no document (node/jest)', () => {
    delete global.document;
    expect(() => jest.isolateModules(() => require('./i18n'))).not.toThrow();
    global.document = fakeDocument;
  });
});
