# Incident: notification email overflow (2026-07-10)

## Summary
- Between ~18:00 and ~20:15 the Vigil account owner (camjesse@gmail.com) received **134
  notification emails** — a spike, not the expected wind-down of "email testing."
- An **archived** person (Tasha Stevenson) kept receiving email. Tasha is demo/seed
  **data in the backend database**, not defined in the `vigil-demo` frontend repo.

## Where the emails come from
- The `vigil-demo` frontend (this repo, static, deployed on Vercel) sends **no email**.
  It only calls the backend API at `https://vigil-production-17ca.up.railway.app`.
- All notification email is generated server-side by **cron services** in the Railway
  project **`discipline-compassion`**.

## Immediate mitigation taken (2026-07-10)
Paused the four email-sending cron services by clearing their Cron Schedule in Railway
(Settings -> Cron Schedule) and removing any active deployment. **App/API left running.**

| Railway service            | Sends            | Original cron schedule (captured to restore) |
|----------------------------|------------------|----------------------------------------------|
| Vigil Incident Reminders   | reminder emails  | hourly  (`0 * * * *`)                         |
| Vigil Weekly Digest        | weekly digest    | 13:00 Mondays only  (`0 13 * * 1`)            |
| Vigil Action Escalation    | escalation email | 13:15 UTC daily  (`15 13 * * *`)              |
| Vigil Expiry Notifications | expiry email     | 13:00 UTC daily  (`0 13 * * *`)               |

> Schedule expressions above are interpreted from the values the owner recorded; verify
> against Railway before restoring so re-enable is exact.

### Left running (intentionally)
- `vigil-production-17ca` (main API) — keeps the app online.
- `vigil schedule generation` — generates shift schedules, not email.
- `vigil webhook retry` — retries outbound webhooks (HTTP), not inbox email.

## Likely root causes (to fix in the backend before re-enabling)
1. **Archived recipients still emailed.** Archiving a worker only soft-sets
   `status='inactive'` (`DELETE /api/workers/:id`); archiving an account hits
   `/api/admin/users/:id/archive`. Neither suppresses notification delivery, so
   inactive/archived people keep getting mail. **Fix:** exclude `status != 'active'`
   (and archived accounts) from every notification recipient query.
2. **Volume spike.** `Vigil Incident Reminders` runs **hourly** and appears to email
   responders for every open incident each run; ~60/hr against a large seeded/test
   incident set matches ~134 over two runs. Pairs with the recent `digest_frequency` /
   weekly-digest change (migration 041, frontend commit `ed3b5e8`). **Fix:** re-check the
   reminder job's recipient scoping + cadence, and gate the digest/test job behind an
   explicit on/off flag.

## Restore checklist (after backend fix is deployed)
- [ ] Confirm recipient queries exclude inactive workers / archived accounts.
- [ ] Confirm incident-reminder scope + cadence are correct.
- [ ] Re-add each cron schedule from the table above, one at a time, watching send volume.
