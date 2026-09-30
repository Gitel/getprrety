// The Terms/Privacy acceptance rule for creating an account. Shared by email signup and
// by Google sign-in when it creates a new user, so the two ways of opening an account
// can never disagree about what counts as valid consent.
//
// The client stamps `consentAcceptedAt` when the user taps the sign-up / Google button
// under the binding "By continuing you agree..." notice (see src/lib/consent.js).
//
// Returns null when consent is valid, otherwise { status, error, code } for the route to send.
// `error` stays English (old app versions read it); `code` is the machine-readable key the
// client translates.
function consentError({ consentAcceptedAt, consentVersion }, now = new Date()) {
  const activeConsentVersion = process.env.CONSENT_VERSION;
  // No configured policy version means we cannot record a meaningful acceptance at all.
  if (!activeConsentVersion) return { status: 503, error: 'Account creation is temporarily unavailable', code: 'signup_unavailable' };

  // The acceptance must be a real timestamp, not in the future, and at most 24 h old -
  // an old stamp would mean the user agreed to the policy long before this signup.
  const acceptedAt = new Date(consentAcceptedAt);
  if (!consentAcceptedAt || Number.isNaN(acceptedAt.getTime()) || acceptedAt > now || now - acceptedAt > 24 * 60 * 60 * 1000)
    return { status: 400, error: 'Terms and privacy consent is required', code: 'consent_required' };

  // The user must have agreed to the policy version that is live right now.
  if (consentVersion !== activeConsentVersion)
    return { status: 400, error: 'Please review the current Terms and Privacy Policy', code: 'consent_outdated' };

  return null;
}

module.exports = { consentError };
