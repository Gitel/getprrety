const { mapVendorError, AnalysisError } = require('./errors');

describe('mapVendorError', () => {
  test('maps the real vendor error for a too-small source image (confirmed against the live API)', () => {
    const err = mapVendorError('error_below_min_image_size');
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err.code).toBe('IMAGE_TOO_SMALL');
    expect(err.recoverable).toBe(true);
  });

  test('maps InvalidParameters (confirmed live: missing file_size before the fix) as a non-recoverable bug', () => {
    const err = mapVendorError('InvalidParameters');
    expect(err.code).toBe('INVALID_PARAMETERS');
    expect(err.recoverable).toBe(false);
  });

  test('unrecognized reasons fall back to a silent, non-recoverable vendor failure', () => {
    const err = mapVendorError('some_new_vendor_error_code');
    expect(err.code).toBe('VENDOR_UNAVAILABLE');
  });
});
