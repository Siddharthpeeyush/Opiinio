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
- Frontend: static editorial-paper pages served by the same app for V1
  (warm cream background, black ink serif headlines, speech-bubble cards
  in teal/coral, balance-scale / tug-of-war Agree–Disagree meter).
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
5. Look: light editorial paper only. Do NOT use the Waxline dark
   vinyl-press look or the dark Liquid Glass look.
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

## What this repo is NOT

- It is NOT the demo prototype artifact (`opinion-app-prototype`):
  that prototype keeps in-memory state, resets on reload, and is not
  shared between real users. This repo is the real product scaffold.
- It is NOT the old checklist folder (`~/workspace/opineo/`), which
  still says Opineo / Liquid Glass. That folder is untouched by this
  scaffold and is superseded by this repo's docs for name and look.
- Auth, database migrations, and feature APIs exist now (Layers 3–5,
  see `docs/decisions/0007-layer3-database.md`,
  `docs/decisions/0008-layer4-auth.md`, and
  `docs/decisions/0009-layer5-apis-privacy.md`); the frontend is
  the next layer (Layer 6+).

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
  Layer 4 (auth) is written in code but providers are NOT yet
  enabled live; see `AUTH-SETUP-GUIDE.md`. Layer 5 (APIs) is
  written in code (`src/services/api.ts`, `api2.ts`,
  `src/routes/api.ts`, `docs/api-conventions.md`) but has made
  no live Supabase call and has no frontend yet; see
  `docs/decisions/0009-layer5-apis-privacy.md` for its gaps.
- GitHub repo: the user creates it; GitHub Apps cannot create user
  repos via API. Push happens after the user creates it and grants the
  app access.
- Custom domain: Opiinio domain availability has not been checked and
  nothing is bought. Do not buy without a separate approval plus the
  exact checkout price.
- Monetization implementation (ads, sponsored debates, premium) is a
  later layer, not V1 scope. The plan was explained to the user; it is
  not yet approved for implementation.
