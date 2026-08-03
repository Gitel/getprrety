class AnalysisError extends Error {
  constructor(code, message, { userMessage = null, recoverable = false } = {}) {
    super(message || code);
    this.name = 'AnalysisError';
    this.code = code;
    this.userMessage = userMessage;
    this.recoverable = recoverable;
  }
}

// Maps a PerfectCorp task error / HTTP failure onto the taxonomy from the integration spec (§6).
// INVALID_PARAMETERS and UPLOAD_INCOMPLETE are bugs, not user-facing errors — never surface them raw.
function mapVendorError(reason) {
  const r = String(reason || '').toLowerCase();
  if (r.includes('no_face') || r.includes('face_not_found')) {
    return new AnalysisError('NO_FACE_DETECTED', reason, {
      userMessage: "We couldn't quite see your face — try facing the camera in good light.",
      recoverable: true,
    });
  }
  if (r.includes('lighting') || r.includes('low_confidence')) {
    return new AnalysisError('POOR_LIGHTING', reason, {
      userMessage: 'Try somewhere brighter — natural light works best.',
      recoverable: true,
    });
  }
  // Confirmed against the live API: a too-small/low-res source image errors as
  // "error_below_min_image_size", not documented in the integration spec's error table.
  if (r.includes('min_image_size') || r.includes('too_small') || r.includes('below_min')) {
    return new AnalysisError('IMAGE_TOO_SMALL', reason, {
      userMessage: 'We need a slightly sharper photo.',
      recoverable: true,
    });
  }
  if (r.includes('invalidparameters') || r.includes('invalid_parameters')) {
    return new AnalysisError('INVALID_PARAMETERS', reason, { recoverable: false });
  }
  if (r.includes('unknown_internal_error') || r.includes('404')) {
    return new AnalysisError('UPLOAD_INCOMPLETE', reason, {
      userMessage: 'Something went wrong — one more try?',
      recoverable: true,
    });
  }
  if (r.includes('insufficient') || r.includes('units') || r.includes('balance')) {
    return new AnalysisError('INSUFFICIENT_UNITS', reason, { recoverable: false });
  }
  return new AnalysisError('VENDOR_UNAVAILABLE', reason, { recoverable: false });
}

module.exports = { AnalysisError, mapVendorError };
