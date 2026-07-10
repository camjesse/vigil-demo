# Backend fix plan: notification email overflow

Companion to `incident-2026-07-10-email-overflow.md`. The four email crons are paused in
Railway, but a fifth send path remains: **event-driven emails from the main API** (e.g.
"Incident reported at 5:21 am" arrived after the crons were paused — sent synchronously
when an incident was created, per the incident escalation policy's mandatory email).

These changes go in the backend that the Railway `discipline-compassion` project deploys
(the API behind `vigil-production-17ca.up.railway.app`). This repo is only the frontend;
none of this can be fixed here.

## Fix 1 — global email kill switch (do this first)

Add one guard at the single choke point where every email leaves the system (the
function that hands a message to the provider — the same place that writes the
`notification_deliveries` row):

```js
// emailer.js (or equivalent) — the one function ALL paths go through:
// crons, incident-created, escalation, digests, invites.
if (process.env.EMAIL_ENABLED === 'false') {
  return recordDelivery({ ...delivery, email_status: 'skipped',
                          email_skip_reason: 'email_disabled_globally' });
}
```

Then `EMAIL_ENABLED=false` set on the Railway API service stops **all** email instantly
— including event-driven sends — without taking the app down, and the admin
Email Delivery view keeps an audit trail of what would have been sent. This is the
switch that was missing yesterday.

## Fix 2 — never email inactive/archived recipients (the Tasha bug)

Archiving today only soft-sets state (`DELETE /api/workers/:id` → `status='inactive'`;
`POST /api/admin/users/:id/archive`). No send path checks it. Enforce it at the same
choke point as Fix 1, not in each caller:

```sql
-- Before sending, resolve recipient eligibility in one query:
SELECT u.id
FROM users u
LEFT JOIN workers w ON w.id = u.worker_id
WHERE u.id = $recipient_id
  AND u.archived_at IS NULL              -- or u.status = 'active', per schema
  AND (w.id IS NULL OR w.status = 'active');
```

Ineligible → record `email_status='skipped', email_skip_reason='recipient_inactive'`.
Also apply the same predicate inside the recipient-list queries used by the crons
(incident reminders, action escalation, expiry notifications, weekly digest) so
archived people never enter the candidate set at all.

## Fix 3 — incident reminders volume

`Vigil Incident Reminders` ran **hourly** and, by the observed volume (~134 emails in
~2h15m), appears to re-email every responder for every open unacknowledged incident on
every run, with the demo/test dataset full of open incidents. Before re-enabling:

- Honor per-policy `reminder_hours` (admin UI already edits it) instead of re-sending
  every run: skip a recipient+incident pair until `last_reminder_at + reminder_hours`.
- Record `last_reminder_at` per (incident, recipient) — likely needs a small table or
  column if it doesn't exist.
- Consider a per-run safety cap (e.g. max N emails/run, log + stop when exceeded).

## Fix 4 — make "Mandatory email" controllable

`PATCH /api/admin/incident-escalation-policies` accepts `mandatory_email` but the admin
UI renders it read-only, and there is no global off. With Fix 1 in place this is less
urgent, but consider letting superadmins toggle it per severity in the UI
(frontend change in this repo: `vigil-admin.html` `renderEscalationPolicies` /
`saveEscalationPolicies`).

## Root cause of the ongoing sends: a smoke-test suite is still running

Email received 2026-07-10 05:21 (after the crons were paused):

> **Incident reported: INC-2026-0007**
> `[SMOKE] Investigation flow 1783682466413 · minor · Calgary Hub HQ`
> From: Vigil Notifications <alerts@notifications.vigilhse.com>

`[SMOKE]` + a `Date.now()` epoch suffix (1783682466413 ≈ 2026-07-10T05:21Z) = an
**automated smoke test creating real incidents in production**. Each created incident
fires an immediate escalation email (mandatory-email path in the API). This is the
"email testing" that was supposed to end — it is still scheduled somewhere.

It is NOT in `vigil-demo` (no workflows, no "SMOKE" strings). Most likely a **scheduled
GitHub Actions workflow in the backend repo (`camjesse/vigil`)** or an external cron
hitting the API. To stop it: repo → Actions tab → find the scheduled smoke/E2E workflow
→ "..." → **Disable workflow**. Search the backend for `[SMOKE]` / `Investigation flow`
to find the runner if it's not an Action.

Compounding loop to be aware of: every smoke run leaves **open, unacknowledged
incidents**, and the (currently paused) hourly incident-reminders cron re-emails
responders for every open incident on every run. That multiplication is the 134-in-2h
spike. **Close/resolve all `[SMOKE]` incidents before re-enabling the reminders cron.**

Verification, in the admin UI:
- **Email delivery** view → the 5:21 row shows recipient, notification, and category.
- **Audit log** view → filter `POST` + `/api/incidents` to see which account the smoke
  suite authenticates as (that account's credentials should also be rotated/disabled).

## Immediate stop for event-driven emails (no deploy needed)

Until Fix 1 exists there is no global off switch, but incident emails can be silenced
from the app: **Admin → Incident Escalation Policy → uncheck Direct manager /
Management chain / Administrators / Admin fallback for every severity → Save policy.**
With no routing recipients, an incident creation has nobody to email — even on the
mandatory path. Reversible; restore the checkboxes after the smoke suite is disabled.
(The "Mandatory email" column itself is read-only in the UI — see Fix 4.)

## Rollout order

1. **Disable the scheduled smoke-test workflow** (backend repo → Actions) — the source.
2. Uncheck escalation routing (above) if any more event emails arrive meanwhile.
3. Deploy Fix 1 + Fix 2 → set `EMAIL_ENABLED=false` on Railway → verify skips appear in
   the Email Delivery view.
4. Close/resolve all open `[SMOKE]` incidents.
5. Apply Fix 3, re-enable crons one at a time (schedules recorded in the incident doc),
   watching the delivery view; restore escalation routing checkboxes.
6. Set `EMAIL_ENABLED=true` once volume looks sane.
