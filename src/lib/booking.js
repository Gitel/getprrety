// Booking / payment page of the clinic ("Book a consultation" item in the side menu).
//
// The URL is a build-time value: vite.config.js inlines process.env.VITE_BOOKING_URL
// into the bundle (same pattern as TERMS_URL in consent.js). When it is not set it is
// simply undefined here.
export const BOOKING_URL = process.env.VITE_BOOKING_URL;

// True only for a well-formed https: URL. The menu hides the booking item unless this
// is true, so a missing or mistyped secret can never produce a dead or unsafe link
// (http:, javascript:, garbage text ...). Whitespace around the value is ignored.
function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    // new URL() throws on anything that is not an absolute, parseable URL.
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

export const BOOKING_READY = isHttpsUrl(BOOKING_URL);
