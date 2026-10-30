# Opiinio — Project Memory

> This file is the project memory for the REAL Opiinio product. It is
> written first, before feature code, per the real_saas_playbook skill
> (Part 0). A decision not recorded here counts as a decision not made.
> Update this file every time a decision is made.

## Product (2 sentences)

Opiinio (O-P-I-I-N-I-O, tagline: EVERY OPINION MATTERS) is a text-only
opinion platform: people write short opinions, reply, vote
Agree / Neutral / Disagree, repost, debate, and follow topics and people —
with no photo, video, or media upload anywhere. It is built to launch at
₹0 on free tiers and to earn later from ads and sponsored debates, not
from paywalling the core.

## Stack (locked for V1 unless a decision record changes it)

- Language / runtime: Node.js 24, TypeScript, strict mode.
- App shape: modular monolith — one deployable app, business logic in
  `src/services/`, thin route handlers in `src/routes/`, never business
  logic in UI components or route handlers.
- Frontend: React 19 + Vite + TypeScript single-page app (decision 0022),
  dark neon theme by default with a light theme toggle (both approved by
  the user from his mockups). Build output goes to `public/`; the old
  vanilla `public/app.js` / `styles.css` are gone.
  Hosting: Netlify free at launch.
- Backend / database / auth: Supabase free (Postgres + Supabase Auth).
  No hand-rolled password hashing or session logic. Google + email auth
  only. No SMS OTP (billed).
- Package tooling: npm, ESLint (flat config), Prettier, `node:test`.
- No other dependencies in V1. Ask before adding a dependency and record
  the reason in `docs/decisions/`.

## Hard rules (do not break without a recorded user decision)

1. Text-only, 280 characters per opinion. No photo/video/media upload
   anywhere. Avatars are initials only at launch; profile photos are NOT
   allowed yet (they would need storage, moderation, and a cost decision).
2. Follow model: public instant follow, like Twitter. NOT follow-request
   approval.
3. Tenancy: personal accounts. Scope every query by `user_id`, never by
   organisation. Team-invite features are OUT OF SCOPE for V1 (see
   `docs/decisions/0005-no-team-invites-v1.md`).
4. ₹0 launch: no paid API, no SMS OTP, no paid dependency. Free tiers
   only (Netlify free, Supabase free). Billing alerts before any upgrade.
5. Look: dark neon by default with a light-theme toggle (decision 0022;
   both themes came from the user's own mockups). Do NOT use the Waxline
   dark vinyl-press look or the dark Liquid Glass look.
6. Money, when premium arrives later: integer minor units (paise), never
   floats. Not in V1 scope.
7. Secrets: never in code, never in git history. `.env.example` holds
   names only, with every variable documented. The app must refuse to
   start with a clear message if a required variable is missing (to be
   enforced when the first real env var is wired; see Open Questions).
8. Working loop (every layer): plan → review plan → implement in small
   steps → verify with lint + typecheck + tests → review diff → record
   decision. Never edit a test to make it pass. Never call work complete
   with a failing or skipped test.
9. Privacy in every aspect (user rule, 2026-10-29; see
   `docs/decisions/0009-layer5-apis-privacy.md`): APIs are hidden
   (no /api/docs, no spec endpoint, no listing route); auth first
   and can() on every route (401 / 403 / private-row 404); private
   tables own-only always; vote aggregates only, never voter lists;
   anonymous masking in every response path; no email, tokens, or
   secrets in responses or logs; generic errors; same-origin /
   APP*ORIGIN CORS only, never '*'; no third-party trackers; no
   enumeration oracles (no profile list, no "is handle/email taken"
   endpoint); explicit columns only, never SELECT \_.

## Commands

```sh
npm install        # install dev dependencies (typescript, eslint, prettier)
npm run dev        # start the dev server (default http://localhost:3000)
npm start          # start the production-mode server (same entry point)
npm run lint       # eslint over src/ and tests/
npm run typecheck  # tsc --noEmit (strict)
npm test           # node:test suite (health endpoint + env validation)
npm run format     # prettier --write over the repo (excluding node_modules, dist)
```

Health check: `GET /api/health` → `200 {"status":"ok","checks":{...}}`.
The scaffold health check reports the app itself only; database/cache
checks are added in the next layer, when Supabase is wired, and must
include timeouts and component-level status (skill: operate-and-scale).

## Architecture decisions (summary; full records in docs/decisions/)

- 0001 Modular monolith, not microservices — solo build, cheaper, easier
  to debug; split later only with a recorded reason.
- 0002 Supabase (Postgres + Auth) over Firebase — SQL migrations,
  row-level security, and a single Postgres schema fit the playbook's
  migration/index/user-scoped-query discipline; Firebase was the
  rejected alternative (see record).
- 0003 Netlify free for frontend hosting over a VPS — ₹0, HTTPS, and
  deploy previews; VPS rejected for V1 (ops cost).
- 0004 No media storage in V1 — text-only by product rule, so the
  upload/pre-signed-URL layer of the skill is deferred, not silently
  skipped.
- 0005 No team invites in V1 — personal accounts only; team features
  from the skill are recorded out of scope, not omitted by accident.
- 0006 Editorial-paper design system over dark glass/vinyl — approved
  by the user 2026-10-28; words are the hero because the product is
  words only.
- 0007 Layer 3 database (migrations, RLS, counts/triggers) — applied
  live 2026-10-29.
- 0008 Layer 4 auth (Supabase Auth, TOTP MFA only, no SMS) — written
  in code, providers not yet enabled live.
- 0009 Layer 5 APIs (validated, privacy-first, hidden) — written
  in code, no live Supabase call, frontend not yet built.
- 0010 Layer 6 frontend (editorial single-page app, /api-only,
  labelled preview mode) — written in code, sign-in/MFA
  end-to-end NOT yet live (no /api/auth route, providers not
  enabled live); see docs/decisions/0010-layer6-frontend.md.
- 0011 Server auth routes (/api/auth/\*, GoTrue proxied from the
  server only, TOTP MFA, aal-gated sensitive actions) — written
  in code, providers not yet enabled live, account deletion
  gated but SERVER_ONLY; see
  docs/decisions/0011-server-auth-routes.md.
- 0012 Live-list pass (feed, notifications, own-profile, and
  post detail fetch live data through /api/\* only, cursor
  pagination with de-duplication by id, 401 → sign-in-required,
  503 → labelled preview) — written in code, no live Supabase
  call; following / replies-by-user / likes-by-user tabs have
  no API route and show honest empty states; see
  docs/decisions/0012-live-list-pass.md.

- 0019 Platform scope (user, 2026-10-29): web + mobile-app +
  web admin panel (operations, insights, self-serve sponsored ads);
  sequencing decided — web launch first, admin panel second, mobile
  third (PWA first at ₹0, native last); assistant-added gaps:
  analytics, admin roles, sponsored-content model, push, age gate,
  Privacy Policy update; see
  `docs/decisions/0019-platform-scope.md`.
- 0020 Netlify Functions adapter (2026-10-29): Netlify free cannot
  run the Node server — `src/functions/api.ts` wraps `route()` as a
  serverless function, `netlify.toml` publishes `public/` and
  200-rewrites `/api/*`; honest limitation: rate limiter is per warm
  instance (strict per-IP buckets under-count distributed bursts);
  see `docs/decisions/0020-netlify-functions-adapter.md`.
- 0021 Grants fix (2026-10-30): migrations 01–05 never GRANTed table
  privileges to anon/authenticated (Postgres 42501 → PostgREST 401 →
  app 503 on every /api call). Migration 06
  `20261030060000_grants.sql` + ALTER DEFAULT PRIVILEGES; applied
  live and verified with an unauthenticated read; see
  `docs/decisions/0021-grants-outage.md`.
- 0022 React frontend rebuild (2026-10-30): user ordered React
  ("react will be best", "this is not a demo, I want real results").
  React 19 + Vite + TS, dark neon default + light theme toggle from
  his mockups, swirl logo as inline SVG; backend untouched. Live QA
  matrix found 3 real bug classes (204-body parse, composite-key
  pagination, camelCase keys) — all fixed with regression tests; see
  `docs/decisions/0022-react-rebuild-dual-theme.md`.
- 0023 Notification triggers (2026-10-30): notifications are created
  by Postgres triggers (migration 07), not the API — five
  SECURITY DEFINER functions (follow, reply, opinion like, reply
  like, repost), no service key in the repo, self/blocked suppression,
  anonymous masking at read time; see
  `docs/decisions/0023-notification-triggers.md`.
- 0025 No sample data as live data (2026-10-30): the feed hero and
  right rail rendered hardcoded preview constants (PREVIEW_QUESTION,
  PREVIEW_METER, "7.2K"/"12.4K", TRENDING, DEBATES) unconditionally —
  a signed-in user saw fake engagement as real. Now mode-branched:
  live mode fetches the real daily question and derives trending
  topics from loaded opinions (meter/debates hidden until they have a
  live source); preview mode keeps labelled samples; see
  `docs/decisions/0025-no-sample-data-as-live.md`.

## What this repo is NOT

- It is NOT the demo prototype artifact (`opinion-app-prototype`):
  that prototype keeps in-memory state, resets on reload, and is not
  shared between real users. This repo is the real product scaffold.
- It is NOT the old checklist folder (`~/workspace/opineo/`), which
  still says Opineo / Liquid Glass. That folder is untouched by this
  scaffold and is superseded by this repo's docs for name and look.
- Auth, database migrations, feature APIs, and the frontend exist
  now (Layers 3–6, see `docs/decisions/0007-layer3-database.md`,
  `docs/decisions/0008-layer4-auth.md`,
  `docs/decisions/0009-layer5-apis-privacy.md`, and
  `docs/decisions/0010-layer6-frontend.md`); live sign-in/MFA and
  live data are the next steps (Layers 7+ plus dashboard steps).

## Open questions (user to confirm)

- Supabase project: CREATED by the user 2026-10-29 — name `opiinio`,
  URL https://moahibzipoyyheaceonp.supabase.co, Status Healthy,
  region eu-west-1 (West EU, Ireland). Anon key still
  pending (placeholders only in `.env.example`); never record the
  service_role key or database password here. Layer 3 migrations
  are APPLIED LIVE 2026-10-29 (4 migrations, each Success in the
  SQL Editor; verification passed: 18 tables, RLS true for all 18,
  policies >= 1 for all 18, opinions_body_check 1–280; see
  `MIGRATION-GUIDE.md`). Note: the dashboard "Last migration"
  label still reads "No migrations" — it only tracks CLI/GitHub
  integration, not SQL-Editor applies, and is not the proof.
  Layer 4 (auth) is written in code; providers went live
  2026-10-29 — Email was already enabled (Confirm email ON), and the
  user created the Google Cloud OAuth client himself while the
  assistant pasted the Client ID + Secret into Supabase via browser
  (verified Google ENABLED; the secret never appeared in chat).
  See `AUTH-SETUP-GUIDE.md`. Layer 5 (APIs) is
  written in code (`src/services/api.ts`, `api2.ts`,
  `src/routes/api.ts`, `docs/api-conventions.md`) but has made
  no live Supabase call; see
  `docs/decisions/0009-layer5-apis-privacy.md` for its gaps.
  Layer 6 (frontend, `public/index.html`, `public/app.js`,
  `public/styles.css`) is written in code; server auth routes
  (`/api/auth/*`, `src/routes/auth.ts`,
  `src/services/authService.ts`) are now also written in code
  and wired to the frontend, but sign-in/MFA end-to-end is NOT
  live (providers not enabled live, migration 05 not applied
  live, no key shared) and no live visual 390px/1440px check
  has been run; see
  `docs/decisions/0011-server-auth-routes.md`. The live-list
  pass (`public/app.js` loaders, `tests/live-list.test.ts`,
  `docs/decisions/0012-live-list-pass.md`) is also written in
  code: feed, notifications, own-profile, and post detail now
  fetch live data through /api/\* when configured, with
  labelled preview fallback when not — but no live Supabase
  call has been run, and following / replies-by-user /
  likes-by-user tabs have no API route yet. Account
  deletion is aal-gated but SERVER_ONLY in this layer (GoTrue
  admin deletion needs a service_role key that is never wired
  here).
- 0013 Layer 11 rate limits + live reply-like fix — written in
  code, NOT pushed, no live Supabase call: `src/lib/rateLimit.ts`
  (fixed-window, in-memory store behind a `RateLimitStore`
  interface so Redis/Upstash can replace it for multi-instance
  later), buckets authStrict 5/15min / authGeneral 20/15min /
  write 60/5min / read 300/5min / search 60/5min, keyed by user
  id first and SHA-256-hashed IP only as fallback (strict auth
  routes dual-key hashed email + hashed IP), generic 429 with
  `Retry-After` and no personal data or enumeration signal,
  wired through `route()` (the deployed path) into both route
  families; sign-out deliberately unlimited; the 0012 reply-like
  branch now calls POST/DELETE `/replies/:id/like` in live mode
  and refetches via `route()`, preview toast unchanged. Tests
  154/154 (`tests/rate-limit.test.ts`, 19 new). Shared-store
  replacement, production tuning, and trusted-proxy handling are
  recorded follow-ups; see
  docs/decisions/0013-rate-limits.md.
- 0014 Layers 7–8 CI/CD + test strategy — written in code, NOT
  pushed: `scripts/scan-secrets.mjs` (zero-dep scanner; clean on
  the tree, catches planted fakes, never echoes values),
  `.github/workflows/ci.yml` (Node 24 pinned; npm ci → scan →
  typecheck → lint → format:check → test on PR + push to main;
  validated structurally only, no live Actions run yet),
  `docs/testing-strategy.md` (bug-first rule, 401/403/404 matrix,
  owed E2E/load/a11y), `CHANGELOG.md` (new, Unreleased section),
  staging-auto / prod-manual guidance + rollback runbook in the
  decision record; no Netlify tokens/keys wired. Tests 159/159
  (`tests/secret-scanner.test.ts`, 5 new). See
  docs/decisions/0014-ci-cd-testing.md.
- 0015 Layer 10 security review — written in code, NOT pushed:
  `docs/security-threat-model.md` (assets, trust boundaries,
  STRIDE-lite per entry point; open items restated, not
  hidden), dependency audit (zero runtime deps; 6 dev-only,
  npm audit --offline 0 vulnerabilities), log-redaction review
  (redacted by construction in src/lib/log.ts; proven in
  tests), `GET /api/account/export` (own data only, auth-first,
  rate-limited, 500-row caps), XSS sweep of public/app.js
  (all user fields esc(); the one raw sink — GoTrue QR SVG —
  now guarded by safeSvg()); account deletion NOT built
  (future admin layer only). See
  docs/decisions/0015-security-review.md.
- 0016 Hosting + observability — written in code, NOT
  pushed: `APP_ENV` (development/staging/production) with
  production-only required vars + placeholder refusal in
  `src/lib/env.ts`; request logs carry `durationMs` + `appEnv`;
  `src/lib/errors.ts` redacted error hook (stderr today,
  swappable); extended `/api/health` (app/config/rateLimiter
  components, `appEnv`, overall status; Supabase honestly
  not_configured/not_checked); `Cache-Control: public,
max-age=600` on static assets only, API stays no-store;
  `docs/hosting.md`, `docs/monitoring.md` (5 signals,
  thresholds, runbooks, incident process). Tests 186/186
  (`tests/observability.test.ts`, 15 new). See
  docs/decisions/0016-hosting-observability.md.
- 0017 Final layer (load/cost + Layer 16) — written in code, NOT
  pushed: `src/lib/audit.ts` id-only audit trail in the log
  stream (MFA enroll/unenroll, password change, deletion
  request, block/unblock, mute/unmute, report; target is an id
  or "self", never content); `scripts/load-test.mjs` zero-dep
  load script — measured ~1,700–1,900 req/s, p95 < 35 ms
  single-process localhost, rate limiter (not CPU) the binding
  constraint; `docs/cost-at-scale.md` (₹0 breaks first at
  Supabase egress ~10k MAU; Netlify free is credit-based for
  new accounts — verify in dashboard); `docs/disaster-recovery.md`
  (no auto backups on free tier — weekly manual dump; restore
  untested); `docs/legal/` drafts (not lawyer-reviewed; age +
  governing law undecided); `docs/moderation.md` (queue is
  future; anonymous control undecided); `docs/pre-launch-checklist.md`.
  Tests 196/196 (`tests/final-layer.test.ts`, 10 new). See
  docs/decisions/0017-final-layer.md. **Playbook build complete
  after this layer** — remaining work is the owner's dashboard
  steps + undecided items in the pre-launch checklist.
- 0018 Polish pass (favicon + route-aware preview banner) — written
  in code, NOT pushed: inline SVG data-URI favicon in
  `public/index.html` (editorial cream/ink "Oi", zero deps);
  `renderModeBanner()` is route-aware (sample-opinions line only on
  screens that show sample opinions) and is now called from
  `route()` on every navigation — this exposed and fixed a real bug
  where the banner never re-rendered after in-app hash navigation.
  Verified live in headless Chromium (5 routes + in-app nav).
  Tests 196/196, lint/typecheck clean. See
  docs/decisions/0018-polish-pass.md.
- GitHub repo: the user creates it; GitHub Apps cannot create user
  repos via API. Push happens after the user creates it and grants the
  app access.
- Custom domain: Opiinio domain availability has not been checked and
  nothing is bought. Do not buy without a separate approval plus the
  exact checkout price.
- Monetization implementation (ads, sponsored debates, premium) is a
  later layer, not V1 scope. The plan was explained to the user; it is
  not yet approved for implementation.
