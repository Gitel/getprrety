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
