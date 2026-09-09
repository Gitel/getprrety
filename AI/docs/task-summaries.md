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

---

## 2026-09-08 — Fix Vite environment values in the browser bundle

**Trigger:** the deployed web app threw `Cannot read properties of undefined
(reading 'VITE_API_URL')` before it could load.

**Cause:** the Vite `define` mappings rewrote `process.env.VITE_*` reads into
`import.meta.env.VITE_*` after Vite's normal environment replacement phase. The
production JavaScript therefore retained `import.meta.env`, which does not exist in a
browser at runtime.

**Changes:** `vite.config.js` now uses `loadEnv()` to read only `VITE_` values during
the build and replaces each legacy `process.env.VITE_*` reference with a JSON-safe
literal. Existing Jest modules can continue to use `process.env`, while the browser
bundle has no runtime environment-object dependency.

**Verification:** built with safe, GitHub-Actions-shaped Vite values; the generated
bundle included the configured API URL and contained no `import.meta.env` references.
`npm test -- --runInBand` passed all 3 suites and 18 tests.

---

## 2026-09-08 — Restore React Native Web animation compatibility

**Trigger:** clicking through the web quiz threw `ReferenceError: global is not
defined` while an animation detached.

**Cause:** React Native Web's animation dependency calls
`global.cancelAnimationFrame`, a Node-style name which is not defined in browsers.
The quiz also requested `useNativeDriver: true`, though React Native Web only supports
the JavaScript driver.

**Changes:** Vite now replaces the dependency's `global` identifier with the browser
equivalent `globalThis` during the build. The quiz fade explicitly uses the supported
JavaScript animation driver, removing the native-driver fallback warning.

**Verification:** production build output contains `globalThis.cancelAnimationFrame`
and no `global.cancelAnimationFrame`; the bundle-level check passed. `npm test
-- --runInBand` passed all 3 suites and 18 tests.

---

## 2026-09-09 — Provision the clinic notification credentials from the deploy pipeline

Task file: `AI/tasks/clinic-email-provisioning.md`

**Trigger:** second report that completing a quiz + registering sends no email to
dzaturansky@gmail.com / lutreat@gmail.com. Follow-up to the 2026-09-08 observability
task, which left the credential as a manual ops step — that step was attempted and
silently did not take.

**Finding:** the application path is intact (quiz → signup → `persistAnalysis()` →
`POST /api/analysis` → `saveAnalysis() created:true` → `notifyClinic()`). The break is
purely configuration, and two new causes were confirmed by running dotenv's own parser:

- The Postmark values sit in the **repo-root `.env`**, but `server/index.js:1` calls
  `dotenv.config()` with no path, so it reads `server/.env`. The API never reads the
  root file.
- `server/.env` line 13 is a literal `printf 'POSTMARK_API_KEY=...'` shell command that
  was pasted instead of executed. dotenv drops the line without a word, so neither key
  parses. The token inside it is 34 chars where Postmark issues 36 — truncated, and it
  would have been rejected anyway.

`notifyClinic()` **resolves** rather than rejecting on this path, so even the route's
`.catch()` never ran. The old deploy `::warning::` was firing but unread.

**Changes (`.github/workflows/deploy.yml` only):** a new `Verify server mail secrets`
pre-flight step that hard-fails when either repository secret is unset; both secrets now
passed to the droplet via the ssh-action `envs` parameter; a new `upsert_env()` that
writes each key into `server/.env` **before** `pm2 restart`; and the old warning loop
replaced by a post-write error assertion that reads the file back.

**Key decision:** the upsert rewrites one key at a time rather than regenerating the
file. `MONGODB_URI`, `JWT_SECRET` and `PERFECTCORP_*` exist only on the droplet, and a
whole-file rewrite from CI would destroy the database credentials.

**Deviation from the previous task's reasoning:** that task argued a mail
misconfiguration must not block a code deploy, so it warned. Now that the pipeline owns
the value, an unset secret is a pipeline configuration error, so the pre-flight fails
the run. The in-script check still cannot fail spuriously.

**Verification:** `deploy.yml` parsed with js-yaml; command order asserted from the
parsed script with comments excluded (upsert at 15, `pm2 restart` at 24); the exact
`upsert_env` body executed against a stub `.env` reproducing the real corruption — both
keys parse afterwards and all pre-existing keys survived byte-intact; a second pass left
exactly one `POSTMARK_API_KEY=` line and rotated the value in place. `npm test` in
`server/` — 18 suites, 108 tests pass, unchanged.

**Left open (manual, cannot be done from the repo):** rotate the Postmark token (it was
exposed in terminal output; `git log -S` confirms it was never committed); add the two
GitHub repository secrets; delete the stray `printf` line from the droplet `.env` and the
misleading `POSTMARK_*` entries from the root `.env`; confirm the boot log after deploy;
run `npm run backfill:clinic` for the clients already missed. Status left `in_progress` —
marking it done needs your say-so.
