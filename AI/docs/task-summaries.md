# Task summaries

Running log of features/improvements/changes, newest last.

---

## 2026-09-08 — Make clinic notification email failures visible

Task file: `AI/tasks/clinic-email-observability.md`

**Trigger:** report that no emails arrive when new users register.

**Finding:** no registration email exists anywhere in the codebase. `POST /api/auth/signup`
and `POST /api/auth/google` send no mail. The only outbound email is `notifyClinic()`,
fired from `POST /api/analysis` on *quiz completion* when a new `SkinAnalysis` is created.
The most likely reason nothing arrives is that `POSTMARK_API_KEY` /
`POSTMARK_SENDER_ADDRESS` were never set in the droplet's gitignored `server/.env` — the
feature shipped 2026-09-01 with five new env vars and no deploy step writes or checks them.
`clinicNotify.getClient()` returned null and no-oped with one `console.warn`.

**Decision:** the missing credential is an ops edit on the droplet and cannot be fixed from
the repo. Fixed the observability gap that hid it instead:

- `mailConfigError()` exported from `clinicNotify.js`; logged at boot in `index.js`, so
  every `pm2 restart` states whether email is on.
- New diagnostic `clinicNotifyError` field on `SkinAnalysis`, written on both env-missing
  paths and on a Postmark rejection, cleared on success.
- `/admin` now shows a warning banner when mail is unconfigured, and the per-client pill
  distinguishes `failed` (hover for the reason) from `not sent`.
- Deploy emits a `::warning::` when the POSTMARK vars are absent from `server/.env`.

**Deviation from the endorsed plan:** the boot check logs loudly rather than exiting.
Hard-failing on a mail misconfiguration would take signup/quiz/analysis down over a
notification outage. Same reasoning for the deploy check warning rather than failing.

**Verification:** `npm test` in `server/` — 18 suites, 108 tests pass, including 8 new
`clinicNotify` tests covering reason-recording, rethrow-on-rejection, error-clearing, and
the persist-failure-does-not-mask-original case. EJS templates compile-checked;
`deploy.yml` parsed with js-yaml and the new shell loop exercised against a stub `.env`.

**Left open:** setting the credentials on the droplet; a genuine registration email if
that is the real requirement; deliverability work (text part / unsubscribe) for the two
gmail.com recipients.

---

## 2026-09-08 — Replace Expo with Capacitor

**Trigger:** migrate the mobile application away from Expo to Capacitor.

**Changes:** replaced Expo dependencies, configuration, Metro entry points, and native
service integrations with Vite, Capacitor, and React Native Web. Added the checked-in
`android/` and `ios/` Capacitor projects, native camera/location/notification permissions,
and Capacitor Camera, Preferences, Geolocation, Local Notifications, and Browser packages.
The web build is now the single bundle copied into both native projects by `npm run cap:sync`.

**Verification:** `npm run cap:sync` completed for Android and iOS, and `npm test --
--runInBand` passed all 18 client tests. Capacitor Doctor reported Android healthy. iOS
native compilation remains a macOS/Xcode step.

---

## 2026-09-08 — Restore GitHub deployment after the Vite migration

**Trigger:** the GitHub Actions deployment run for the Capacitor/Vite migration failed
before reaching the DigitalOcean droplet.

**Finding:** `.github/workflows/deploy.yml` still ran `npx expo export --platform web`,
but Expo is no longer a project dependency. The current web build is `npm run build`,
which invokes Vite and reads `VITE_*` configuration values.

**Changes:** retained the successful `npm ci --legacy-peer-deps` dependency install;
replaced the obsolete Expo export with `npm run build`; mapped the four existing
`EXPO_PUBLIC_*` repository secrets to Vite runtime variable names; and added a
fail-fast check for `VITE_GOOGLE_WEB_CLIENT_ID` so the deployed site cannot silently
hide Google sign-in.

**Verification:** run the Vite production build locally with the existing environment
configuration; validate the workflow's required variable names and build command before
pushing. GitHub Actions still requires the repository secret
`VITE_GOOGLE_WEB_CLIENT_ID` to be configured before its next deployment can succeed.

---

## 2026-09-08 — Allow the post-sign-up selfie step to scroll

**Trigger:** the later onboarding selfie screen could not scroll to reveal its content
on compact viewports.

**Cause:** `SkinSelfieScreen.web.jsx` used a fixed flex `View` for all of its content,
so it did not create a scrollable region when the safe-area viewport was shorter than
the page content.

**Changes:** replaced that wrapper with a flexed `ScrollView` and changed the content
wrapper to `flexGrow: 1`. The screen therefore remains vertically centered when it fits,
but can overflow and scroll on shorter screens. Added vertical padding so the top and
Continue button are not flush against the viewport edges.

**Verification:** `npm run build` completed successfully. Git whitespace validation
also completed without errors.
