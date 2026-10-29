# 0021 — Missing table GRANTs caused the /api/\* outage (post-mortem)

Date: 2026-10-30
Status: accepted

## Context

After the Netlify function adapter (0020) shipped, the live site's
`/api/opinions` returned 503 while `/api/health` reported production with
all env vars present. The first hypothesis was a bad anon key (the user
had pasted a truncated copy from Supabase's UI), and the user re-pasted
the full publishable key via the copy icon and redeployed. The 503s
persisted.

A read-only check of the Supabase API logs (unified logs, last 60 min)
settled it: 16 requests to `GET /rest/v1/opinions` all returned HTTP 401,
but the gateway logged the API key as a _valid publishable key_ — the
401s came from PostgREST because Postgres raised 42501 "permission
denied for table opinions" on every request. The key was fine; the
database was refusing the anon role at the table door.

Root cause: migrations 01–05 created the tables and the RLS policies but
never GRANTed table privileges to `anon`/`authenticated`. Tables created
by the postgres superuser carry no grants by default, and RLS policies
are only evaluated _after_ the role passes the table-privilege check.
Layer 3's verification checked "RLS enabled on all 18 tables" but never
ran a live read, so this shipped undetected. My miss, owned.

## Decision

- New migration `20261030060000_grants.sql`: `GRANT SELECT` on all 18 V1
  tables to `anon`; `GRANT SELECT, INSERT, UPDATE, DELETE` to
  `authenticated`; plus `ALTER DEFAULT PRIVILEGES` so future migrations
  applied by the same role inherit the grants. Least privilege mirrors
  the policies (anon holds no write grant anywhere).
- GRANTs do not bypass RLS: the migration-04 policies remain the real
  enforcement (public reads, owner-only writes, own-rows-only private
  tables). The grants only let the roles reach the policy check.
- Regression test added to `tests/database.test.ts` (static, in the
  existing style): every V1 table must appear in the grants migration's
  table list, and the anon/authenticated grant statements plus the
  default-privileges statements must exist. This test would have failed
  on the pre-fix tree.
- Standing verification rule, added to `MIGRATION-GUIDE.md`: after any
  migration is applied live, run one unauthenticated read against a
  public table (e.g. `GET /rest/v1/opinions?select=id&limit=1` with the
  anon key) before calling the migration verified. "RLS enabled" alone
  is not proof the API path works.

## Consequences

- The grants migration must be applied in the Supabase SQL Editor
  (live database step, like migrations 01–05) before the site can serve
  reads. No app code changed; no redeploy needed for the grants to take
  effect, but the function was already live.
- The 401→503 mapping added in the ccee1291 follow-up stays: a rejected
  service key (or any future privilege regression) still surfaces as a
  generic 503, never a key-oracle 401.
