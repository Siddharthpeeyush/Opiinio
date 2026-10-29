# Opiinio hosting — staging / production topology

Status: guidance for V1. No environments are created by this repo;
the user creates them in the Supabase and Netlify dashboards (his
logins, his taps). Nothing here holds credentials, tokens, or keys.

## Intended topology

```
                    ┌─────────────────────────┐
                    │  Netlify site: staging  │  APP_ENV=staging
                    │  (auto-deploy on merge) │
                    └────────────┬────────────┘
                                 │  anon key (staging)
                    ┌────────────▼────────────┐
                    │ Supabase project:       │
                    │ opiinio-staging         │  ← separate project,
                    └─────────────────────────┘    separate keys,
                                                   separate data
                    ┌─────────────────────────┐
                    │  Netlify site: prod     │  APP_ENV=production
                    │  (MANUAL publish only)  │
                    └────────────┬────────────┘
                                 │  anon key (production)
                    ┌────────────▼────────────┐
                    │ Supabase project:       │
                    │ opiinio  (live today)   │  ← the eu-west-1
                    └─────────────────────────┘    project; prod data only
```

- **One Netlify site per environment.** Staging auto-deploys on
  merge to `main`; production deploys are MANUAL (publish from
  the Netlify dashboard) — see the rollback runbook in
  `docs/decisions/0014-ci-cd-testing.md`.
- **One Supabase project per environment.** Staging and
  production NEVER share a project, a database, or an anon key.
  The live project today (`opiinio`, eu-west-1) becomes
  production; the user creates `opiinio-staging` later.
- **The app is stateless.** The only in-process state is the
  Layer 11 in-memory rate-limit store (single instance is the
  V1 launch shape; the shared-store follow-up is recorded in
  decision 0013). No sessions, uploads, or caches live in the
  process, so a redeploy loses nothing.

## Environment variable matrix

| Variable            | development (local) | staging               | production        |
| ------------------- | ------------------- | --------------------- | ----------------- |
| `APP_ENV`           | `development`       | `staging`             | `production`      |
| `SUPABASE_URL`      | optional            | optional (preview ok) | **required**      |
| `SUPABASE_ANON_KEY` | optional            | optional (preview ok) | **required**      |
| `APP_ORIGIN`        | optional            | set to staging URL    | **required**      |
| `PORT`              | `3000`              | platform-assigned     | platform-assigned |
| `NODE_ENV`          | `development`       | `production`          | `production`      |

Startup behaviour (`src/lib/env.ts`):

- Missing/invalid `APP_ENV` → refuse to boot (names the variable).
- `APP_ENV=production` with a missing Supabase/origin var →
  refuse to boot: `Missing required environment variable: NAME`.
- `APP_ENV=production` with a placeholder value (`your-…`,
  `example`, `changeme`, `placeholder`, `<…>`) → refuse to boot:
  `Invalid value for environment variable: NAME`. Messages name
  the variable only — values are never echoed.
- development/staging boot without Supabase vars in labelled
  preview mode (API routes return generic 503; nothing is faked
  as live).

## Staging vs production behaviour

Deliberate decision (recorded in
`docs/decisions/0016-hosting-observability.md`): behaviour is
**identical** except the environment name. `APP_ENV` appears in
`/api/health` (`appEnv`) and in every request log line
(`appEnv`), and it gates startup strictness — nothing else
branches on it. No "staging-only" features, no relaxed auth in
staging: staging must be prod-faithful or it proves nothing.

## Deploy checklist (per environment)

1. Create the Supabase project (staging) or confirm the live
   one (production); apply the migrations in order via the SQL
   Editor; verify (18 tables, RLS on all, 280-char checks) —
   see `MIGRATION-GUIDE.md`.
2. Enable the Email provider (+ Confirm email) and the Google
   provider in Supabase Auth; set Site URL / Redirect URLs —
   see `AUTH-SETUP-GUIDE.md`.
3. In Netlify: new site from the GitHub repo; set the env vars
   from the matrix above (dashboard → Site settings →
   Environment variables). Never commit them.
4. Deploy; then `GET /api/health` → 200, `appEnv` matches the
   environment, `checks.database.status` is `not_checked`
   (honest until the live-probe layer) — never a faked `ok`.
5. Run the two-user cross-user proof (AUTH-SETUP-GUIDE §5)
   against staging before promoting anything to production.
6. Billing alerts: set them on Supabase (and Netlify) the day
   the projects are created — ₹0 holds at launch scale, not
   automatically at 20,000 MAU (see system-design load math).

## What this doc does NOT do

- Create any project, site, key, or DNS record.
- Promise backup/restore: Supabase free backups exist in
  theory; a restore into a separate project is untested and
  is a pre-launch item (see decision 0014 follow-ups).
- Cover the custom domain (unchecked, unbought — needs a
  separate approval + exact checkout price).
