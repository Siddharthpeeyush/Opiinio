# 0014 — Layers 7–8: CI/CD + test strategy

Status: Accepted for V1. Implemented locally, NOT pushed (no
GitHub push in this step, per the task). No live Supabase call,
no users created, no providers enabled live, no key invented or
requested. Zero new runtime dependencies; zero new dev
dependencies (the scanner is plain node, the workflow uses
GitHub-hosted actions only).

## Context

The playbook (skill `real_saas_playbook`, "Ship with tests and
deployment") requires: Git hygiene (gitignore, pre-commit lint
and format, a secret scanner, a commit message convention, a
history scan for committed secrets), CI on every PR and push to
main (install, lint, typecheck, unit tests, integration tests,
build, fail-fast), CD with preview deployments for PRs,
automatic staging deploys on merge, manual approval for
production, automatic migrations before new code goes live, and
a documented rollback.

Opiinio adaptations, recorded honestly:

- There is no local git repo in this workspace: pushes to
  GitHub go through the user's GitHub connector approval flow,
  and the snapshot procedure verifies each push by read-back.
  So "pre-commit hooks" here means a runnable script plus a
  one-line install instruction, not an enforced hook — and the
  CI workflow cannot be live-proven from this codebase.
- Migrations run through the Supabase SQL Editor by hand (the
  user authorized "run it urself" for Layer 3); there is no
  CLI/GitHub-integration apply, so "automatic migrations before
  new code goes live" becomes a checklist item in the runbook,
  not automation.

## Decisions

- **Secret scanner: `scripts/scan-secrets.mjs` (plain node, zero
  deps).** Patterns: private-key headers, AWS access keys,
  GitHub tokens (classic + fine-grained), Slack tokens, Stripe
  live keys, `service_role` mentioned with a value nearby (JWT
  or long quoted string — mere mentions in docs/comments are
  NOT flagged), JWT assigned to any key/token/secret name,
  password assignments, DB connection strings with credentials.
  Assignment patterns require a QUOTED string literal, so
  `apikey: config.anonKey`, `password: cleanPassword`, and TS
  type annotations (`password: unknown`) do not trip it.
  Placeholder values (`your-…`, `changeme`, `<…>`) and
  obvious test fakes (dictionary words, `1234` runs, `!!!!`
  repeats, values under 12 chars) are treated as clean.
  Findings print `file:line [pattern]` ONLY — the secret value
  is never echoed, consistent with the standing privacy rule
  (no secrets in logs).
- **Pre-commit usage:** `node scripts/scan-secrets.mjs` before
  every commit. Manual one-time hook install (git hooks are not
  committable; run once per machine that commits):
  `printf '#!/bin/sh\nnode scripts/scan-secrets.mjs\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`
  CI also runs the scanner, so a missed local hook still fails
  the PR.
- **CI: `.github/workflows/ci.yml`.** Triggers: `pull_request`
  and `push` to `main`. Node pinned to **24** (matches the
  stack decision in AGENTS.md; `package.json` engines says
  `>=22`). Steps: checkout → setup-node with npm cache →
  `npm ci` → secret scan → `npm run typecheck` →
  `npm run lint` → `npm run format:check` → `npm test`.
  No matrix, so fail-fast is the default behavior.
- **Validation status: structural only.** The YAML parses and
  every step maps to a real `package.json` script, but no
  GitHub Actions run has happened — recorded honestly in the
  workflow file's header comment. The first live run happens
  after this file is pushed and a PR/push triggers it.
- **Deploy flow (guidance, not wired — no Netlify API tokens or
  deploy keys anywhere in this repo):**
  - Pull requests → Netlify Deploy Previews, automatic once the
    user connects this repo to Netlify (his dashboard, his
    login).
  - Merge to main → staging build auto-deploys.
  - Production → MANUAL. The user publishes a deploy from the
    Netlify dashboard. Nothing in this repo can deploy to
    production on its own.
- **Commit message convention** (matches the history so far):
  `Layer N: <what changed>` for layer work, e.g.
  `Layer 11: rate limits…`. One layer per commit; the push
  procedure verifies by read-back before reporting done.
- **Test strategy: `docs/testing-strategy.md`.** Covers what
  exists (node:test, fake store + GoTrue stubs, live-server
  proofs with placeholder env, secret-scanner tests), the
  bug-first rule, the don't-fool-me report contract, the
  cross-user 401/403/404 matrix, test-quality review items,
  and what remains owed (E2E against staging with a real
  browser, load tests p50/p95/p99, a11y audit, CI live run).

## Alternatives considered

- **Husky / lint-staged for pre-commit hooks:** rejected — new
  dev dependency for what a one-line shell hook does; the ₹0 /
  zero-dep preference wins. Revisit if hooks need to be shared
  across machines automatically.
- **A marketplace secret-scanning Action (e.g. GitHub's own
  secret scanning / gitleaks Action):** rejected for CI in
  favor of the repo's own script — same zero-dep reasoning,
  and the script is calibrated to this repo's idioms so CI
  does not drown in false positives on test fixtures.
- **Committing a `.git/hooks/pre-commit` file:** impossible —
  git does not track hooks. Hence the script + install
  instruction + CI backstop instead.

## Rollback runbook

Use when a deploy is bad (broken pages, 5xx spike, failed
health check). Production deploys are manual, so rollback is a
human action in the Netlify dashboard — no credentials live in
this repo.

1. **Identify the last good commit.** In the GitHub repo,
   open the commit list on `main`; the bad deploy is the
   newest. The last good commit is the newest one whose
   Netlify deploy shows "Published" and a clean deploy log.
   Cross-check: the app's `/api/health` should have returned
   200 (app-scope) on that deploy. When in doubt, ask what
   changed in the newest commit — the CHANGELOG names the
   layer.
2. **Redeploy the good commit in Netlify.** Netlify dashboard
   → the Opiinio site → Deploys → find the successful deploy
   built from the last good commit → "Publish deploy". This
   is instant and does not rebuild.
3. **Verify.** `GET /api/health` → 200. Load the homepage and
   one opinion page. Sign-in screen renders. Watch Netlify's
   function logs for 5xx for ten minutes.
4. **Database.** Migrations are additive and applied by hand
   in the Supabase SQL Editor — a rollback NEVER edits an
   applied migration. If the bad deploy included a migration,
   write a fix-forward migration; never rewrite history.
5. **Then fix forward.** Reproduce the bug locally, add the
   failing test first (bug-first rule), fix, verify the suite
   green, and push as a new commit — never force-push `main`.
6. **Note:** Netlify is not connected yet (the user connects
   it himself when the code is ready to deploy). This runbook
   activates at connection time; until then the equivalent of
   "rollback" is "the previous GitHub commit is the good one".

## Verified this layer

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm test` — 159/159 (154 pre-existing green + 5 new in
  `tests/secret-scanner.test.ts`).
- Scanner: `node scripts/scan-secrets.mjs` on the repo tree →
  clean (75 files scanned), exit 0. Against a scratch dir with
  5 planted fakes (service_role JWT, AWS key, RSA private key,
  password, DB URL) → 6 findings, exit 1, no secret value
  echoed.
- CI YAML: parses (structural validation output below); every
  step maps to a real `package.json` script; Node pinned to 24.
- `git status`: no git repo in this workspace (pushes go via
  the GitHub connector) — and no secret was written anywhere
  outside the scratch fixtures, which were deleted.

## Follow-ups recorded (not this layer)

- **CI live run** — happens after the workflow file is pushed.
- **Full history secret scan** — the 8 pushed commits were
  built locally and contain no secrets (code + placeholder
  `.env.example` only), but a systematic scan of GitHub
  history has not been run; do it once via the connector
  before launch.
- **Staging/prod split** — guidance only here; separate
  Supabase projects/keys, billing alerts, and env validation
  are the later hosting layer.
- **E2E, load tests, a11y audit** — owed per
  `docs/testing-strategy.md`.
- **Migration automation** — currently manual SQL-Editor
  applies; a CLI/GitHub-integration apply is a future
  decision (needs the user's call, since it changes who can
  touch the live DB).

## Honest gaps / not fully enforceable here

- The scanner is pattern-based and heuristic: a real secret
  containing a dictionary word ("secret", "test", "password")
  or a `1234` run could slip past. It is a tripwire, not a
  proof — flagged findings still need human review, and the
  residual risk is why the pre-commit instruction and CI
  backstop both exist.
- Pre-commit enforcement is per-machine and manual (git hooks
  are not committable); a machine without the hook relies on
  CI to catch the slip.
- The workflow file has never run on GitHub Actions; a YAML
  typo in an action version or runner label would only show
  up on the first live run.
