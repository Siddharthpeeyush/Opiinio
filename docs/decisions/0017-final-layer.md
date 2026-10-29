# 0017 — Final layer: load/cost checks + Layer 16 (audit, DR, legal, moderation, pre-launch)

Status: Accepted for V1. Implemented locally, NOT pushed (no
GitHub push in this step, per the task). No live Supabase call,
no users created, no providers enabled live, no key invented or
requested. Zero new runtime dependencies; zero new dev
dependencies.

**This completes the playbook build.** After this layer, the
remaining work is the owner's dashboard steps and undecided
product calls in `docs/pre-launch-checklist.md` — no more code
layers are owed by the 15-layer playbook for V1.

## Context

The playbook's final stretch requires: load tests with
p50/p95/p99, cost modelling at 10x/100x, audit logs,
transactional-email setup, disaster recovery with a tested
restore, legal pages, admin/moderation, analytics, feature
flags, onboarding, i18n, and a pre-launch checklist. Opiinio
adaptations, recorded honestly:

- **Load test: local only.** `scripts/load-test.mjs` hammers
  the real server on localhost. Staging load testing stays
  owed (checklist C4) — this layer proves the request path,
  not the network or Supabase.
- **No transactional email setup:** the app sends no email;
  Supabase Auth sends its own. SPF/DKIM/DMARC is not ours to
  configure.
- **Restore untested:** the DR procedure is written, never
  run. The drill is a post-launch checklist item.
- **Legal drafts only:** TERMS.md / PRIVACY.md are
  plain-language drafts against the real schema — explicitly
  not lawyer-reviewed, with undecided lines marked.

## Decisions

- **Audit trail = the structured log stream, not a new
  table** (`src/lib/audit.ts`). A table would need a
  migration, RLS, and a query surface to defend for data no
  user should ever read through the app. The log stream is
  append-only by nature, needs no migration, and inherits
  the privacy rule by construction: `AuditEntry` exposes
  ONLY `{requestId, userId, action, target, appEnv}` —
  there is no field a secret, email, password, topic, word,
  or reason could arrive on. `target` is a row id, a GoTrue
  factor id, or the literal `"self"`; muted topics/words
  audit with `target: null` because the topic/word text is
  user content. Wired into: MFA enroll/unenroll, password
  change, account-deletion request (audited AFTER the aal
  gate passes, BEFORE the SERVER_ONLY throw — the request
  must survive even though this codebase never completes
  the deletion), block/unblock (target = the other user's
  id), mute/unmute topic/word (target null), report file
  (target = report id).
- **Load test** (`scripts/load-test.mjs`, zero-dep):
  configurable URL/concurrency/duration/routes; reports
  p50/p95/p99, throughput, error counts; pure helpers
  exported for the test suite. Measured, not estimated
  (below).
- **Cost at scale** (`docs/cost-at-scale.md`): 1x/10x/100x
  table from the system-design rates against verified
  Oct-2026 free limits. Two findings worth naming: (1) the
  ₹0 story breaks first at **Supabase egress (5 GB/mo)**,
  around ~10k MAU — not at the database; (2) **Netlify
  free is credit-based for new accounts** (~15 GB effective,
  not 100 GB) — the owner must check which model applies
  in the dashboard. First paid step: Supabase Pro ~$25/mo
  (estimate, verify at the time), only when a meter says so.
- **Disaster recovery** (`docs/disaster-recovery.md`):
  code is safe in git; the schema rebuilds from migrations;
  the honest gap is DATA — Supabase free has **no automatic
  backups** (verified), so a weekly manual `pg_dump`
  routine is specified until a paid tier exists. RPO ~24h
  with dumps (≈ everything without them); RTO "hours,
  untested". Restore procedure written, drill owed
  post-launch.
- **Legal** (`docs/legal/TERMS.md`, `PRIVACY.md`): short
  drafts against the real schema. Privacy states the
  account-deletion gap honestly instead of promising it.
  Age threshold (13+ vs 18+) and governing law are marked
  UNDECIDED — the owner chooses.
- **Moderation** (`docs/moderation.md`): the report flow
  that exists, the review queue as documented future (owner
  reviews, starting SLAs), and the anonymous-mode control
  **left UNDECIDED** (1/day limit vs queue-first) for the
  owner — implementing neither silently is forbidden by
  this doc.
- **Pre-launch checklist** (`docs/pre-launch-checklist.md`):
  every remaining item with owner + status; nothing marked
  done that isn't; deferred Layer-16 items (analytics,
  feature flags, onboarding, i18n, status page) recorded
  in section E, not silently dropped.

## Alternatives considered

- **Audit as a Postgres table with RLS:** rejected — a
  table nobody queries through the app is pure attack
  surface; the log stream already has the retention and
  append-only properties, and the host log viewer is where
  an owner actually reads it.
- **k6 / autocannon for load testing:** rejected — new
  dev dependency (k6 needs a binary; autocannon is npm)
  for numbers a 100-line node script produces. Zero-dep
  was the requirement and it is met.
- **Hiding the 429s in the load report:** rejected —
  they are the most informative part (see below).

## Verified this layer

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm test` — **196/196** (186 pre-existing green + 10
  new in `tests/final-layer.test.ts`: 2 audit shape, 4 api
  audit wiring, 1 auth audit wiring, 3 load-script helpers).
- Secret scanner — clean on the tree.
- **Load test, actually run** (local server, no env,
  20 concurrent workers, 15 s, routes `/`, `/app.js`,
  `/api/health`, `/api/opinions`):
  - Run 1: 28,484 requests, **1,898 req/s**,
    p50 8.1 ms / p95 26.4 ms / p99 45.2 ms / max 129.7 ms.
  - Run 2: 25,478 requests, **1,698 req/s**,
    p50 8.6 ms / p95 32.4 ms / p99 54.4 ms.
  - Per-route p95 (run 1): `/` 30.5 ms, `/app.js`
    31.8 ms, `/api/health` 17.0 ms, `/api/opinions`
    17.3 ms.
  - Errors run 1: 300× HTTP 503 (preview-mode
    `/api/opinions` — no Supabase env, expected) +
    6,813× HTTP 429. Errors run 2: 6,362× HTTP 429, zero
    5xx (limiter state persisted in-process, so 429 fired
    before the store call). **Zero fetch errors, zero
    unexpected 500s.**
  - Reading: the binding constraint under sustained load
    was the **rate limiter working as designed** (all
    localhost traffic shares one IP key; the 300/5min
    read bucket engaged), not CPU. Throughput is ~90×
    the system-design peak of 19 req/s.

## What the load numbers prove — and don't

- Prove: this codebase's request path (routing,
  validation, rate limiter, JSON serialization) handles
  ~1,700+ rps single-process with p95 < 35 ms on
  localhost. The system-design p95 < 300 ms target has
  enormous headroom at the app layer.
- Don't prove: real network latency, Supabase/PostgREST
  latency (every `/api/*` here returned 503/429 without
  touching a database), multi-instance behaviour, or
  write-path load. The staging load test (checklist C4)
  is the one that proves those.

## Follow-ups recorded (not this layer)

- Everything in `docs/pre-launch-checklist.md` sections
  A–E.

## Honest gaps / not fully enforceable here

- The audit trail's durability is the host's log
  retention (ephemeral on free tiers) — it is a
  security trail, not a compliance archive.
- Cost numbers are estimates from per-user rates that
  have never met real users; first re-run after 30 days
  of traffic.
- RPO/RTO are estimates; the restore has never been run.
- Legal drafts are not lawyer-reviewed; three lines are
  undecided (age, governing law, support channel).
