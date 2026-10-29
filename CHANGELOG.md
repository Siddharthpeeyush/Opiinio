# Changelog — Opiinio

All notable changes, newest first. One entry per layer. Dates in IST.

## Unreleased

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
