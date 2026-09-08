---
title: Make clinic notification email failures visible
status: done
completed_at: 2026-09-08
summary_logged: true
---

# Context

Reported symptom: "we do not receive emails upon registering new users."

## Investigation findings

There is **no registration email in the codebase**. Neither `POST /api/auth/signup`
nor `POST /api/auth/google` sends mail. The only outbound email is `notifyClinic()`,
fired from `POST /api/analysis` (`server/routes/analysis.js:95`) when a *new*
`SkinAnalysis` document is created — i.e. on quiz completion, not on registration.

The trigger chain, every link of which failed silently:

```
signup -> persistAnalysis() (fire-and-forget) -> POST /api/analysis
  -> saveAnalysis() created:true -> notifyClinic()
    -> needs POSTMARK_API_KEY + POSTMARK_SENDER_ADDRESS -> Postmark accepts -> delivered
```

Ranked causes:

1. `POSTMARK_API_KEY` / `POSTMARK_SENDER_ADDRESS` unset in the droplet's
   `server/.env`. The feature shipped 2026-09-01 (`355ef24`) introducing five new env
   vars; the deploy does `git reset --hard` + `npm install` + `pm2 restart` and never
   writes or validates `.env` (gitignored, droplet-only). `getClient()` returned null
   and no-oped with a single `console.warn`. **Most likely.**
2. Code may not have reached the droplet — every deploy from 2026-08-03 to 2026-09-07
   failed (see `37ae6e2`), and the email feature merged inside that window. The failing
   step was likely `systemctl reload nginx`, which ran *after* `pm2 restart`, so the code
   probably did land — inferred, not verified.
3. No analysis created at all (client-side `analysis_save_failed`) so nothing triggers.
4. Postmark account state: sender signature unverified / server pending approval / bad
   message stream. Threw into a `console.error` and nowhere else.
5. Delivered but filtered — recipients default to two gmail.com addresses, HTML-only
   body, no text part, no unsubscribe.

Cause 1 cannot be fixed from the repo: it is an edit to a file on the droplet.
This task therefore addresses the *observability* gap that let it go unnoticed for a
month, and leaves the credential itself as a manual ops step.

## Changes

- `server/services/clinicNotify.js`
  - New exported `mailConfigError()` — returns a human-readable reason or null.
  - New internal `recordFailure()` — best-effort persist of the reason; a write error
    is logged, never allowed to mask the original failure.
  - Both env-missing paths and a rejected Postmark send now record the reason.
  - A rejected send is recorded and **rethrown** — caller behaviour unchanged, and the
    record stays un-stamped so it remains retryable.
  - Success clears `clinicNotifyError`.
- `server/models/SkinAnalysis.js` — new `clinicNotifyError: { type: String, default: null }`.
- `server/index.js` — boot-time log stating whether clinic email is configured.
- `server/routes/admin.js` — passes `mailProblem` to the client list view.
- `server/views/admin/list.ejs` — warning banner when mail is unconfigured; per-row
  pill now distinguishes `failed` (hover for reason) from `not sent`.
- `server/views/admin/customer.ejs` — shows "Last email error" when relevant.
- `server/views/admin/_head.ejs` — `.warn` shares the existing `.allergy` banner rule.
- `.github/workflows/deploy.yml` — droplet-side check that `POSTMARK_API_KEY` and
  `POSTMARK_SENDER_ADDRESS` are present in `server/.env`, emitted as `::warning::`.

## Key decisions

- **Boot check logs, does not exit.** The endorsed wording was "fail fast at boot",
  but hard-exiting on a mail misconfiguration would take down signup, quiz and analysis
  over a *notification* outage — converting a partial failure into a total one. The log
  fires on every `pm2 restart`, which achieves the actual goal (an operator can see it
  without waiting for a quiz completion). One-line change if a hard exit is preferred.
- **Deploy check warns, does not fail.** Same reasoning: mail config must not block a
  code deploy.
- **`clinicNotifyError` is diagnostic only.** Nothing branches on it; it is not a retry
  queue. `clinicNotifiedAt` remains the sole idempotency guard.

## Data impact

Additive, nullable, no migration required. Existing documents read as `null`
("not sent", as before) until their next notification attempt.

## Out of scope (deliberately not done)

- Setting the credentials on the droplet — manual ops step, no repo access to prod.
- A registration email. If "notify us when someone registers" is the real requirement,
  that is a new hook in the signup route, not a fix to `clinicNotify`.
- Retry/queue for failed sends. `scripts/backfillClinicNotify.js` already covers manual
  recovery.
- A plain-text body / unsubscribe header to improve gmail deliverability (cause 5).
- The Expo -> Vite + Capacitor migration in the working tree (user handling separately).
