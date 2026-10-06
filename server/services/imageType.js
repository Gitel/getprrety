// Detects an image's type from its first bytes ("magic bytes") instead of trusting the
// file name or the browser-sent Content-Type, both of which the uploader controls.
// Shared by the user photo upload (routes/uploads.js) and the admin catalogue photo.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {Buffer} buffer  The uploaded file's bytes.
 * @returns {'image/jpeg'|'image/png'|null}  null for anything else (or non-Buffer input).
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  // JPEG starts FF D8 FF.
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // PNG starts with the full 8-byte signature.
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  return null;
}

module.exports = { detectImageType };
