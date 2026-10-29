# Opiinio disaster recovery

Status: final layer (0017). The restore procedure below is
**written but UNTESTED** — no restore has ever been run. The
first restore drill is a post-launch checklist item, not a
pre-launch gate.

## What is protected, and by what

| Asset            | Protection                                                                                              | Notes                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Application code | Git — GitHub repo `Siddharthpeeyush/Opiinio`, branch `main`                                             | Every layer pushed + verified; nothing exists only on a laptop.                                                                         |
| Database schema  | Migration files in `supabase/migrations/` (versioned in git)                                            | A fresh database can be rebuilt to the exact schema by applying migrations in order.                                                    |
| Database DATA    | **Nothing automatic on the free tier.** Supabase free has **no automatic backups** (verified Oct 2026). | This is the gap. See "manual backup routine" below.                                                                                     |
| Auth users       | Live in the Supabase `auth` schema (same Postgres)                                                      | Covered by whatever DB backup exists; GoTrue provider config (Google client etc.) is dashboard state and must be re-entered manually.   |
| Secrets/keys     | **Never in git** (secret scanner + CI enforce this)                                                     | Re-enter from the owner's records. There is no "restore" for a lost anon key — rotate it in the Supabase dashboard and update env vars. |

## Honest RPO / RTO (estimates, not guarantees)

- **RPO (how much data we can lose):** with no backup routine,
  **everything since the project was created**. With the daily
  manual dump below: **~24 hours**. With Supabase Pro ($25/mo
  est.): 24 hours of daily backups, 7-day retention.
- **RTO (how long to be back):** **hours, untested.** Best guess:
  1–3 hours for a practiced run (new project + restore +
  migrations + env re-point + health check). The first drill
  will replace this guess with a number.

## Manual backup routine (free tier — do this weekly from launch)

Until a paid tier or an automated dump exists:

1. Supabase dashboard → Database → Backups (or SQL Editor):
   run `pg_dump` against the project (connection string from
   dashboard → Database → Connection string; use the pooler
   string, read-only role if available).
2. Store the dump OUTSIDE Supabase (owner's machine or
   encrypted drive — never in the git repo, never in chat).
3. Name it `opiinio-YYYYMMDD.dump`. Keep the last 4.
4. Log the backup date somewhere durable (calendar entry,
   not memory).

Automating this (GitHub Actions + `pg_dump` on a schedule) is a
recorded follow-up — it needs the DB password in Actions
secrets, which is the owner's call.

## Restore procedure (untested — drill before trusting)

1. Create a NEW Supabase project (do not reuse the broken
   one's name until DNS/env are ready to cut over).
2. Restore the dump: `pg_restore` / `psql < dump.sql`
   against the new project.
3. Apply any migrations in `supabase/migrations/` NEWER than
   the dump date, in filename order, via the SQL Editor
   (same paste-in-order flow as `MIGRATION-GUIDE.md`).
4. Re-create: Auth providers (Email + Google — client secret
   re-entered, never from chat), Site URL / Redirect URLs,
   and confirm TOTP MFA is enabled.
5. Update the app's env vars (`SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `APP_ORIGIN`) to the new project.
6. Boot with `APP_ENV=production` — the env validator
   refuses placeholder values, so a mis-pointed restore
   fails loudly instead of serving wrong data.
7. Verify: `/api/health` 200 with `appEnv:"production"`;
   sign in as the owner; spot-check feed, profile, and one
   anonymous opinion's masking.
8. Cut traffic over (Netlify env vars / DNS), then run the
   two-user cross-user proof from `AUTH-SETUP-GUIDE.md` §5.

## Scenarios

- **Accidental row deletion / bad migration:** restore the
  dump to a THIRD project first, extract the rows, replay
  them — never restore over the live project blind.
- **Supabase region outage (eu-west-1):** no multi-region
  story in V1. Mitigation is the dump + a new project in
  another region; RTO is "hours, untested" (above).
- **Supabase free project paused (1 week inactivity):**
  NOT a disaster — resume from the dashboard. Keep a
  weekly heartbeat (even the backup routine counts as
  activity).
- **GitHub repo loss:** code is also in `~/workspace/opiinio`
  and in every pushed commit; re-push from local. (The repo
  is public, so "loss" really means account loss — the
  local copy + CI history cover it.)
- **Lost anon key:** rotate in dashboard, update env vars,
  redeploy. No data impact.

## What is deliberately NOT in V1

- Point-in-time recovery (paid add-on even on Pro).
- Automated backup verification (restore drill covers it
  manually).
- Multi-region failover.
- A status page (recommended post-launch in
  `docs/monitoring.md`).
