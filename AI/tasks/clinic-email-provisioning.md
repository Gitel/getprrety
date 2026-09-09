---
title: Provision the clinic notification credentials from the deploy pipeline
status: in_progress
completed_at: null
summary_logged: true
---

# Context

Reported symptom, second report: "when a user completes a quiz and registers, email is
not sent to dzaturansky@gmail.com and lutreat@gmail.com."

Follow-up to `AI/tasks/clinic-email-observability.md`, which added the diagnostics but
deliberately left the credential itself as a manual ops step. That manual step was
attempted and silently did not take. This task closes the provisioning gap.

# Investigation findings

The application path is intact and was re-verified end to end:

```
quiz complete -> SignUpScreen.jsx:57 -> persistAnalysis() -> POST /api/analysis
  -> saveAnalysis() {created:true} -> notifyClinic()   (routes/analysis.js:95)
```

The break is entirely in configuration. `getClient()` (`clinicNotify.js:16`) returns
null when `POSTMARK_API_KEY` is unset, so `notifyClinic()` exits at `clinicNotify.js:122`
with `{ sent:false, reason:'no-client' }`. Note it **resolves rather than rejects**, so
the `.catch()` on the route never fires either.

Two new, concrete findings the previous investigation did not have — both confirmed
locally by running dotenv's own parser:

1. **The credentials are in the wrong `.env` file.** `server/index.js:1` calls
   `require('dotenv').config()` with no path, which resolves against `process.cwd()`,
   i.e. `server/.env`. The root `.env` — the Expo/Vite one — is where
   `POSTMARK_API_KEY` and `POSTMARK_SENDER_ADDRESS` actually sit. The API never reads
   that file.

2. **`server/.env` line 13 is a shell command that was pasted, not executed.** It
   literally begins `printf 'POSTMARK_API_KEY=...\nPOSTMARK_SENDER_ADDRESS=...`.
   dotenv silently drops the whole line; neither key parses. The token embedded in it is
   also 34 characters where a Postmark server token is a 36-character UUID, so it appears
   truncated and would have been rejected even if the line had parsed.

3. Nothing provisions the values. `render.yaml` does not list them, and `deploy.yml`
   only emitted a `::warning::` on an otherwise green run. Its grep was
   `^POSTMARK_API_KEY=.+`, which does not match the `printf '...` line — so the warning
   was firing, unread.

**Not verified:** the droplet's own `/var/www/getprrety/server/.env`. No `gh` CLI is
available locally and production was deliberately not accessed. Settled on the box with
`grep -c '^POSTMARK_API_KEY=' /var/www/getprrety/server/.env`.

# Changes

- `.github/workflows/deploy.yml`
  - New `Verify server mail secrets` pre-flight step — hard-fails the run when either
    repository secret is unset. Kept separate from the existing `Verify web build
    secrets` step because these are server-side and play no part in the Vite build.
  - `Deploy server` step now passes both secrets to the remote shell via the
    ssh-action `envs` parameter.
  - New `upsert_env()` in the deploy script writes each key into `server/.env`,
    **before** the `pm2 restart` (dotenv re-reads the file on process start).
  - The old `::warning::` loop became a post-write `::error::` assertion that reads the
    file back.

# Key decisions

- **Per-key upsert, never a whole-file rewrite.** `MONGODB_URI`, `JWT_SECRET` and the
  `PERFECTCORP_*` values exist *only* in the droplet's `.env`. Regenerating the file
  from the workflow would destroy the database credentials. `upsert_env` filters out
  one key and appends it back, leaving every other line untouched.
- **Read the file back after writing it.** The bug being fixed was a write that did not
  take, so "the write command ran" is not evidence. The assertion cannot fail
  spuriously — if the upsert worked, it passes.
- **Pre-flight fails the deploy; the previous in-script check only warned.** The earlier
  reasoning (a notification misconfiguration must not block a code deploy) applies to a
  value the pipeline cannot control. Now that the pipeline owns the value, an unset
  secret is a pipeline configuration error and should stop the run before it ships.
- **Atomic `mv` with 0600.** A part-way failure leaves the previous `.env` intact, and
  the credentials are never briefly world-readable.
- **The stray `printf '...` line is left in place.** It is inert (dotenv ignores it) and
  automatically deleting arbitrary lines from a production `.env` is riskier than the
  line itself. Flagged for manual removal instead.

# Verification

- `deploy.yml` parsed with js-yaml; step list and `envs` wiring confirmed.
- Command order asserted programmatically from the parsed script, comments excluded:
  `upsert_env` at index 15, `pm2 restart` at index 24.
- The exact `upsert_env` body executed against a stub `.env` reproducing the real
  corruption. Result: both keys parse under dotenv; `MONGODB_URI`, `JWT_SECRET`, `PORT`,
  `PERFECTCORP_API_KEY` and `SKIN_ANALYSIS_MAX_POLL_MS` all survived byte-intact.
- Second pass over the already-fixed file: still exactly one `POSTMARK_API_KEY=` line,
  and a rotated value replaced the old one in place. Idempotent.
- `npm test` in `server/` — 18 suites, 108 tests pass (unchanged; no server code touched).

# Remaining manual steps (cannot be done from the repo)

1. Rotate the Postmark server token — the old one was exposed in terminal output. It was
   never committed (`git log -S` across all branches is clean).
2. Add `POSTMARK_API_KEY` and `POSTMARK_SENDER_ADDRESS` as GitHub repository secrets.
   The deploy now fails without them.
3. Delete the stray `printf '...` line from the droplet's `server/.env`, and the
   now-misleading `POSTMARK_*` entries from the repo-root `.env`.
4. After the first deploy, confirm `pm2 logs server` prints
   `✉️  Clinic notification email configured`.
5. Run `npm run backfill:clinic -- --days=30 --dry-run`, then without `--dry-run`, to
   send the clients already missed.

# Out of scope

- A genuine registration email. There is still no mail on `POST /api/auth/signup`; the
  only outbound email is the quiz-completion clinic summary. If "email us when someone
  registers" is the real requirement, that is a separate hook in the signup route.
- Deliverability work (plain-text part / unsubscribe header) for the two gmail.com
  recipients.
- A token *format* check in the pre-flight. It would have caught the truncated token,
  but risks false-failing a deploy if Postmark changes its token shape.
