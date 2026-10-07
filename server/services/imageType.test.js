const { detectImageType } = require('./imageType');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

test('detects JPEG and PNG by magic bytes', () => {
  expect(detectImageType(JPEG)).toBe('image/jpeg');
  expect(detectImageType(PNG)).toBe('image/png');
});

test('rejects other formats, short buffers and non-buffers', () => {
  expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
  expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  expect(detectImageType(PNG.subarray(0, 7))).toBeNull();
  expect(detectImageType(Buffer.alloc(0))).toBeNull();
  expect(detectImageType(null)).toBeNull();
  expect(detectImageType('not a buffer')).toBeNull();
});
