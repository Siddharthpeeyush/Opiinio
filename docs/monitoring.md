# Opiinio monitoring plan

Status: plan for V1. No vendor account is created by this repo;
the error hook (`src/lib/errors.ts`) writes redacted JSON to
stderr today, which the host platform's log viewer (Netlify
function logs) already captures. A dedicated tracker is a
plug-in, not a rewrite.

## What to watch

Technical (from request logs — every line carries `requestId`,
`route`, `method`, `status`, `durationMs`, `appEnv`, `userId`):

1. **5xx rate** — any `level:"error"` line or `status >= 500`.
2. **429 spikes** — `status: 429` per route; distinguishes attack
   from mis-tuned buckets.
3. **p95 latency** — `durationMs` per route pattern (never raw
   paths); watch `/api/opinions` feed and `/api/auth/signin`.
4. **Failed logins** — `route:"/api/auth/signin"`, `status: 401`
   rate per 5 minutes (credential-stuffing signal; the strict
   bucket is 5/15min per email+IP).
5. **Export usage** — `route:"/api/account/export"` volume; a
   spike means scraping-by-account or a bug looping.

Product (later, needs analytics — not this layer):

- signups/day, opinions/day, DAU. No tracker is wired in V1
  (standing rule: no third-party trackers); count from the
  database when needed, never from client beacons.

Uptime: homepage `GET /`, `GET /api/health` (200 + `status:"ok"`),
and the sign-in screen render. `/api/health/live` is the
lightweight load-balancer probe (no checks at all).

## Alert thresholds (starting values — tune after real traffic)

| Alert         | Threshold                           | Duration | Severity |
| ------------- | ----------------------------------- | -------- | -------- |
| 5xx spike     | > 1% of requests, or any 5 in 5 min | 5 min    | page     |
| Health down   | `/api/health` non-200               | 2 min    | page     |
| 429 spike     | > 50/min on one route               | 10 min   | ticket   |
| p95 latency   | > 1500 ms on feed route             | 15 min   | ticket   |
| Failed logins | > 30/min on `/api/auth/signin`      | 5 min    | ticket   |
| Export spike  | > 20/hour on `/api/account/export`  | 1 hour   | ticket   |

Severity "page" = wake someone up; "ticket" = look within the
day. With one human (the user), "page" means a phone
notification from the monitor he chooses.

## Runbooks

### 5xx spike

- **Meaning:** the app is throwing on real requests.
- **Check:** filter logs `level:"error"`; group by `route`.
  Note the `requestId`s — full detail is in the error hook
  output (name only, redacted by construction).
- **Likely causes:** bad deploy (newest commit), Supabase
  unreachable (GoTrue/PostgREST 503s), a migration mismatch.
- **Action:** if it started with the newest deploy → rollback
  per `docs/decisions/0014-ci-cd-testing.md` (Netlify: publish
  the last good deploy). If Supabase is down → nothing to
  roll back; wait, and confirm recovery via `/api/health`.
- **Escalate:** if 5xx persists 30 min after rollback, the
  cause is data/config, not code — check env vars and the
  Supabase dashboard status page.

### Health down

- **Meaning:** the process is not answering at all.
- **Check:** Netlify deploy status; then `/api/health/live`.
- **Likely causes:** failed deploy, platform incident,
  process crash-loop (bad env → boot refusal shows in logs
  as `Missing required environment variable: NAME`).
- **Action:** boot-refusal → fix the env var in the Netlify
  dashboard and redeploy. Crash-loop otherwise → rollback to
  the last good deploy, then fix forward (bug-first rule).

### 429 spike

- **Meaning:** someone (or something) is hammering a route.
- **Check:** group 429s by `route`; check whether `userId`
  is set (signed-in abuser) or null (anonymous).
- **Likely causes:** scraper, a frontend bug looping, or
  buckets tuned too tight for real use (shared-IP NAT —
  college/hostel — is the known false-positive source, see
  decision 0013).
- **Action:** abuse → leave the limiter doing its job; watch.
  False positives → retune the bucket (decision 0013) and
  push a new commit. Never disable the limiter to "fix" it.

### p95 latency high

- **Meaning:** the app is slow, not broken.
- **Check:** which route pattern; `durationMs` distribution.
- **Likely causes:** N+1 author loading in lists (known,
  Layer 5 gaps), Debates tab fanning out per-opinion reply
  fetches (known, decision 0012), Supabase slowness.
- **Action:** no hotfix path in V1 — record, profile
  locally, fix forward. If Supabase-side, check its dashboard.

### Failed-login spike

- **Meaning:** possible credential stuffing.
- **Check:** 401s on `/api/auth/signin` per 5 min; the
  strict bucket (5/15min per email+IP) should already be
  absorbing it — confirm 429s accompany the 401s.
- **Action:** usually no action (the limiter is the action).
  If logins are ALSO succeeding at volume, treat as account
  takeover until proven otherwise: force a review, not a
  code change.

### Export spike

- **Meaning:** unusual `/api/account/export` volume.
- **Check:** distinct `userId`s vs one account looping.
- **Action:** one account → contact the user; many accounts
  → likely a frontend bug; fix forward.

## Status page

Recommendation: a hosted status page (e.g. the free tier of a
status-page provider, or a static page updated by hand) — NOT
built in this layer, no account created. Minimum viable: the
user posts from his own account when an incident lasts > 30
min. A formal page becomes worth it after launch, not before.

## Incident process (lightweight, V1)

1. Notice (alert) → 2. Mitigate (rollback is the default
   first move) → 3. Verify (`/api/health`, homepage, one
   opinion page) → 4. Write 5 lines: what happened, impact,
   cause, fix, what would have caught it earlier → 5. Turn
   line 5 into a test or a monitor change. No blameless
   theatre needed at this size — just the five lines.
