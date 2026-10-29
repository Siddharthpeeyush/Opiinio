# Changelog — Opiinio

All notable changes, newest first. One entry per layer. Dates in IST.

## Unreleased

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
