# 0016 — Hosting + observability layer

Status: Accepted for V1. Implemented locally, NOT pushed (no
GitHub push in this step, per the task). No live Supabase call,
no users created, no providers enabled live, no key invented or
requested. Zero new runtime dependencies; zero new dev
dependencies.

## Context

The playbook ("Operate and scale") requires: structured JSON
logging with request ids and redaction, error tracking with a
staging-only verification route, no empty catch blocks, a
monitoring plan with alert rules and a runbook per alert, a
status page, an upgraded health endpoint with component-level
status, staging/prod on different databases and keys, billing
alerts, fail-fast env validation, a caching strategy that never
caches authenticated data at shared layers, and correct
Cache-Control headers.

Opiinio adaptations, recorded honestly:

- **No vendor error tracker.** `src/lib/errors.ts` exposes
  `reportError(err, ctx)` + `setErrorReporter()`; today the
  reporter writes redacted JSON to stderr (₹0, no SDK, no DSN
  invented). A future Sentry/self-hosted sink plugs in without
  changing call sites. The staging-only throw route the skill
  asks for is NOT added — with no tracker wired, a throw-test
  route would only prove stderr works; it gets added with the
  first real sink.
- **No status page created.** Recommended in
  `docs/monitoring.md`; built after launch, not before.
- **No separate staging Supabase project created.** The
  topology, env matrix, and deploy checklist are documented in
  `docs/hosting.md`; creation is the user's dashboard step.
- **Health honesty preserved.** Supabase components stay
  `not_configured` / `not_checked` — the new `app`,
  `config`, and `rateLimiter` components are the only ones
  allowed `ok`, because they are facts about this process,
  not claims about a remote system.

## Decisions

- \*\*Env validation (`src/lib/env.ts`): `APP_ENV` =
  development | staging | production (default development).
  Production refuses to boot when `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, or `APP_ORIGIN` is missing or holds a
  placeholder (`your-…`, `example`, `changeme`,
  `placeholder`, `<…>`). Messages name the variable only —
  values are never echoed. Staging/dev keep preview-mode
  boot (generic 503s, nothing faked live). This finally
  enforces AGENTS.md hard rule 7, which had been marked
  "to be enforced when the first real env var is wired".
- **Staging ≡ production behaviour.** The ONLY thing
  `APP_ENV` changes is startup strictness, the `appEnv`
  field in `/api/health`, and the `appEnv` key in log lines.
  No relaxed auth, no staging-only features — staging must
  be prod-faithful or it proves nothing.
- **Request logs (`src/lib/log.ts`):** every line now carries
  `requestId`, `route` (pattern, never raw ids), `method`,
  `status`, `durationMs`, `appEnv`, `userId`. Redacted by
  construction — the type still exposes nothing else, and
  the security tests were extended to prove the new keys
  exist and no new personal data flows.
- **Error hook (`src/lib/errors.ts`):** `reportError` is
  called from the three catch-alls (api.ts, auth.ts,
  server.ts) for **5xx only** — 4xx client errors are noise,
  not incidents. The report carries the error NAME only: no
  message (may embed user input), no stack (may embed paths
  or secrets). A broken reporter can never break the request
  path (try/catch inside).
- **Health (`GET /api/health`):** now reports `appEnv`, an
  overall `status` (`ok`; `degraded` reserved for the layer
  that adds live probes), and components `app`, `config`,
  `rateLimiter` (`{status:"ok", store:"in-memory"}`),
  `database`, `auth`. `/api/health/live` stays the
  zero-check load-balancer probe.
- **Monitoring (`docs/monitoring.md`):** five technical
  signals (5xx rate, 429 spikes, p95 latency, failed logins,
  export usage), starting thresholds, a runbook per alert
  (symptom → check → action → rollback pointer to 0014),
  and a 5-line incident process.
- **Caching rule (this layer's small item):** never cache
  authenticated user data at shared layers (CDN/proxy) —
  API responses already send `cache-control: no-store` via
  `SECURITY_HEADERS`. Only static assets (`/`, `/index.html`,
  `/styles.css`, `/app.js`) may carry cache headers:
  `public, max-age=600`, a conservative starting value
  because filenames are not content-hashed in V1 (short TTL
  bounds post-deploy staleness). Recorded here, not in a
  separate doc, per the task.

## Alternatives considered

- **Requiring Supabase vars in staging too:** rejected —
  staging is allowed to boot in preview mode so the user
  can stand the site up before creating the staging
  project; production is the only environment where
  "configured" is mandatory. Revisit if staging ever needs
  to prove full auth flows (it will — before launch).
- **Vendor error tracker now (Sentry free tier):**
  rejected — new account, new SDK, new DSN to guard, for a
  pre-launch app whose stderr already lands in the host's
  log viewer. The hook interface keeps the option open at
  zero switching cost.
- **Long cache TTLs / hashed filenames:** rejected for V1 —
  the build has no hashing step; a short TTL is the honest
  cache policy until the frontend build grows one.
- **Per-route latency alerting below 1500 ms p95:**
  rejected as a starting value — free-tier cold starts
  would page constantly; tune after real traffic.

## Verified this layer

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm test` — **186/186** (171 pre-existing green + 15 new
  in `tests/observability.test.ts`: 7 env validation, 1 log
  shape, 3 error hook, 2 health, 2 cache headers).
- Secret scanner — clean on the tree.
- Local server proof (ephemeral ports): `/api/health` → 200 with
  `appEnv:"development"`, components `app`/`config`/
  `rateLimiter` ok and Supabase `not_configured` (no env);
  boot with `APP_ENV=production` + placeholder values →
  refused with the generic message (variable named, value
  not echoed); a request log line parses as JSON with
  `requestId`, `durationMs`, `appEnv`, and no personal data.
- API responses still carry `cache-control: no-store`
  (SECURITY_HEADERS unchanged); static assets carry
  `public, max-age=600`.

## Follow-ups recorded (not this layer)

- **Load tests** (p50/p95/p99 on the five key endpoints) —
  still owed, its own layer.
- **Live RLS proof / two real users / providers live** —
  unchanged, still the user's dashboard steps.
- **Staging Supabase project creation** — user's step, in
  `docs/hosting.md` checklist.
- **Billing alerts** — set the day the projects exist.
- **Staging-only error-throw verification route** — with
  the first real error-tracking sink.
- **Rate-limit bucket tuning, shared store** — after real
  traffic (0013).
- **Cache TTL tuning / hashed filenames** — after real
  traffic or a frontend build step.

## Honest gaps / not fully enforceable here

- Thresholds in `docs/monitoring.md` are starting values
  from reasoning, not from traffic — the first real alert
  tuning happens after launch.
- `durationMs` is wall-clock inside the handler; it does
  not separate Supabase time from app time. Per-dependency
  timing is a later instrumentation step.
- The "no shared caching of authenticated data" rule is
  enforced in this codebase (no-store on API, short TTL on
  statics) but cannot bind a CDN/proxy the user configures
  later — `docs/hosting.md` states the rule for that step.
- A staging deploy that skips the env matrix (e.g.
  `APP_ENV` left `development` on the staging site) would
  silently run preview-mode rules; the health check's
  `appEnv` field is the tripwire — the deploy checklist
  tells the user to verify it.
