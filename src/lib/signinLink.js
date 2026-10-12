import { api } from './api';

// Sign-in link support. The clinic sends a customer a link like
//   https://getpretty.app/#signin=<token>
// Opening it signs the customer in without a password. The token sits in the URL HASH
// (not the query) so it is never sent to a server or written to server logs.

// Reads the token from the current URL, then ALWAYS removes it from the address bar at once,
// so it cannot leak through a screenshot, a copied URL or the browser history entry.
// Returns the token string, or null when there is none (or when not running in a browser).
export function readSigninToken() {
  if (typeof window === 'undefined' || !window.location) return null;
  const hash = window.location.hash || '';
  if (!hash) return null;

  // "#signin=abc&other=1" -> parse like a query string. Other hash params are tolerated
  // and kept in the URL; only the signin part is removed.
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has('signin')) return null;
  const token = params.get('signin');

  // Strip the signin part immediately (before any network call), keeping path + search
  // (e.g. ?ref=lu_clinic must survive) and any other hash params.
  params.delete('signin');
  const rest = params.toString();
  try {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search + (rest ? `#${rest}` : ''),
    );
  } catch { /* history can be unavailable in odd embeds; the token is still returned */ }

  return token || null;
}

// Exchanges the token for a session. `consent` is the optional { consentAcceptedAt,
// consentVersion } stamp from consentParams(); a brand-new invited customer must send it.
// `options` is passed to api.js (e.g. { timeoutMs } so boot can use a short timeout).
// Resolves to { token, user, isNew }; rejects with api.js errors (err.code = 'link_invalid', ...).
export function redeemSigninLink(token, consent, options) {
  return api.post('/api/auth/link/redeem', { token, ...(consent || {}) }, options);
}
