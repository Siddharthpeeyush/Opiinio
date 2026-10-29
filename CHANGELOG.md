# Changelog — Opiinio

All notable changes, newest first. One entry per layer. Dates in IST.

## Unreleased

### Missing table GRANTs outage fix (2026-10-30)

- **Post-mortem:** the live API's 503s were not a bad anon key — the
  Supabase API logs proved the key was valid and accepted. Every
  PostgREST call failed with Postgres 42501 "permission denied for
  table" because migrations 01–05 created tables + RLS policies but
  never GRANTed table privileges to `anon`/`authenticated` (my miss in
  Layer 3 verification — "RLS enabled" was checked, a live read never
  was). See docs/decisions/0021-grants-outage.md.
- Added `supabase/migrations/20261030060000_grants.sql`: `GRANT SELECT`
  to `anon`, `GRANT SELECT, INSERT, UPDATE, DELETE` to `authenticated`
  on all 18 V1 tables, plus `ALTER DEFAULT PRIVILEGES` for future
  tables. Grants do not bypass RLS — the migration-04 policies remain
  the real enforcement.
- Added a regression test (`tests/database.test.ts`, static like the
  rest): every V1 table must appear in the grants migration with the
  anon/authenticated grant statements present. This would have failed
  on the pre-fix tree.
- `MIGRATION-GUIDE.md` now carries the standing rule: after ANY live
  migration, run one unauthenticated read (`set role anon; select id
from public.opinions limit 1;`) before calling it verified.
- Also fixed: `require-await` lint error in the ccee1291 401→503
  regression test (`tests/api.test.ts`) — the earlier "lint clean"
  claim was wrong; lint is actually clean now.

### Netlify Functions adapter (2026-10-29)

- **Honest correction:** Netlify's free tier serves static files and
  cannot run the app's long-lived Node server — the repo had no
  `netlify.toml` and no serverless adapter, so a plain deploy could
  not serve `/api/*`. The hosting layer documented topology without
  verifying the runtime fits the host; that miss is fixed here.
- Added `src/functions/api.ts`: a thin Netlify Function translating
  Netlify HTTP events → `route()` → HTTP responses. Nothing is
  reimplemented — routing, auth, validation, rate limiting, and
  privacy all stay in `route()` and below. Zero runtime dependencies.
- Added `netlify.toml`: build `npm run build`, publish `public/`,
  functions `dist/src/functions`, 200-rewrite `/api/*` to the function
  (original URL preserved).
- Known limitation (recorded, not hidden): the in-memory rate limiter
  is per warm function instance on serverless, so strict per-IP
  buckets under-count distributed bursts; auth-keyed buckets are
  unaffected in practice. The shared-store follow-up (decision 0013)
  now covers this too.
- Tests 200/200 (`tests/netlify-function.test.ts`, 4 new: event
  mapping, non-API 404, env-refusal 503, base64 body decoding —
  through the real `route()`).
- Decision record: `docs/decisions/0020-netlify-functions-adapter.md`.

### Platform scope: web + admin panel + mobile (2026-10-29)

- User expanded scope: Opiinio must be web + mobile-app based, plus a
  web-based admin panel (operations, insights, self-serve sponsored
  ads). Sequencing decided by the user: web launch first, admin panel
  second, mobile third (PWA first at ₹0, native last).
- Gap analysis added by the assistant at the user's request:
  analytics instrumentation, admin roles in the DB, sponsored-content
  data model, push notifications, anonymous-mode abuse controls, age
  gate, Privacy Policy update for ads/trackers, deep links, Play
  Store listing decision.
- Decision record: `docs/decisions/0019-platform-scope.md`.

### Polish pass (2026-10-29)

- Added an inline SVG data-URI favicon (`public/index.html`): cream
  rounded square, ink border, serif "Oi" — matches the editorial look,
  zero dependencies, works offline and under `file://`.
- Preview-mode banner is now route-aware (`public/app.js`): the
  "Sample opinions below are illustrative only" line shows only on
  screens that render sample opinions (feed, explore, debates,
  notifications, profile, post, welcome); sign-in, onboarding,
  compose, settings get the shorter preview line.
- Bug found and fixed: the banner never re-rendered on hash-change
  navigation (was boot-only). `route()` now calls
  `renderModeBanner()` after setting `state.route`. Verified live in
  headless Chromium, including in-app navigation without reload.
- Decision record: `docs/decisions/0018-polish-pass.md`. Local only,
  not pushed.

### Final layer: load/cost checks + Layer 16 (2026-10-29)

- Added `src/lib/audit.ts`: id-only audit trail in the structured
  log stream (no new table) — MFA enroll/unenroll, password
  change, account-deletion request, block/unblock, mute/unmute,
  report filing. Target is an id or "self", never user content.
- Added `scripts/load-test.mjs`: zero-dep load script (p50/p95/p99,
  throughput, errors). Measured locally: ~1,700–1,900 req/s,
  p95 < 35 ms single-process; the rate limiter (not CPU) was the
  binding constraint.
- Added `docs/cost-at-scale.md` (1x/10x/100x vs free quotas;
  ₹0 breaks first at Supabase egress ~10k MAU; Netlify free is
  credit-based for new accounts — verify in dashboard),
  `docs/disaster-recovery.md` (free tier has no automatic
  backups — weekly manual dump routine; restore untested),
  `docs/legal/TERMS.md` + `PRIVACY.md` (drafts, not
  lawyer-reviewed; age + governing law undecided),
  `docs/moderation.md` (report flow exists; review queue is
  future; anonymous-mode control undecided),
  `docs/pre-launch-checklist.md` (every remaining item, owner
  - status), `docs/decisions/0017-final-layer.md`.
- 196/196 tests green (186 pre-existing + 10 new).

### Layers 7–8: CI/CD + test strategy (2026-10-29)

- Added `scripts/scan-secrets.mjs`: zero-dependency secret scanner
  (private keys, provider tokens, service_role key material,
  JWT-in-assignment, password/DB-URL assignments). Findings report
  file:line:label only — secret values are never printed. Clean on
  the current tree (70 files); catches planted fakes.
- Added `tests/secret-scanner.test.ts`: scanner exits 0 on clean
  fixtures (variable references, type annotations, fake test values,
  placeholders), 1 on planted service_role JWT / provider tokens /
  password / DB URL / private key, 2 on bad usage.
- Added `.github/workflows/ci.yml`: Node 24 (pinned), `npm ci`,
  secret scan, typecheck, lint, format check, tests — on PR and push
  to main, fail-fast. Validated structurally only; no live Actions
  run yet.
- Added `docs/testing-strategy.md`: what the suite covers now, the
  bug-first rule, the don't-fool-me report contract, the
  cross-user 401/403/404 matrix, test-quality review checklist, and
  what remains owed (E2E against staging, load tests, a11y audit,
  CI live run).
- Added `docs/decisions/0014-ci-cd-testing.md`: decisions,
  staging-auto / prod-manual deploy guidance, and the rollback
  runbook.
- 159/159 tests green (154 pre-existing + 5 new).
