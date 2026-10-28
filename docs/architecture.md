# Opiinio — Architecture

Status: Part 0 / Layer 2 plan + scaffold. This document records the
architecture that the scaffold implements. Feature endpoints are NOT
part of this step.

## 1. Shape: modular monolith

One deployable Node.js + TypeScript application. Modules are separated
by folder, not by service, so a solo developer can debug a request
end-to-end in one process and one log stream.

```
┌─────────────────────────────────────────────────────────────┐
│  Netlify (static hosting + CDN, free)                       │
│  Serves the editorial-paper web UI; calls the API below.    │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS / JSON
┌──────────────────────────▼──────────────────────────────────┐
│  Opiinio app (modular monolith, Node + TypeScript)          │
│  src/routes/     thin HTTP handlers, validation at boundary │
│  src/services/   business logic ONLY (never in routes/UI)   │
│  src/lib/        env validation, logging, errors, config    │
│  src/db/         Supabase client + query helpers (later)    │
│  src/jobs/       scheduled / background jobs (later)         │
└──────────────────────────┬──────────────────────────────────┘
                           │ Postgres + Auth (Supabase)
┌──────────────────────────▼──────────────────────────────────┐
│  Supabase free                                              │
│  Postgres (tables, RLS, indexes) + Supabase Auth (Google +  │
│  email). No SMS OTP. Storage is unused in V1 (text-only).   │
└─────────────────────────────────────────────────────────────┘
```

Component diagram (text form, kept in-repo so it cannot drift from
the code without a diff):

- `src/server.ts` — entry point: validates env, starts HTTP server,
  wires routes, graceful shutdown.
- `src/app.ts` — route table: `GET /` (landing page, editorial look),
  `GET /api/health` (scaffold health check), `GET /api/health/live`
  (lightweight liveness probe, added in this scaffold for load
  balancers; the full component health check is a later layer).
- `src/routes/health.ts` — thin handler only; it calls
  `src/services/healthService.ts` and formats the response.
- `src/services/healthService.ts` — the only business logic in this
  scaffold: builds the health payload, checks env presence (names
  only, never values in output).
- `src/lib/env.ts` — env validation: required variables are listed,
  missing ones produce a clear startup error naming the variable.
  In this scaffold step, NO variable is required yet (Supabase is not
  wired), so the server starts without env — this is intentional and
  is recorded as a stub to be tightened in the next layer.
- `public/` — static editorial-paper landing page (HTML + CSS only,
  no JS framework, no secrets). This is a scaffold placeholder page,
  not the full app UI; full screens are a later layer.
- `tests/` — `node:test` suite, no test framework dependency.

## 2. Stack per layer, with one rejected alternative each

| Layer                | Chosen                                                                                         | Rejected alternative, and why                                                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime / language   | Node.js 24, TypeScript strict                                                                  | Python/FastAPI — also good, but the prototype, Netlify tooling, and the developer's existing JS sites share one language; switching would add a second stack for no V1 benefit.                                                                                                                                          |
| App shape            | Modular monolith                                                                               | Microservices — far more ops, deploys, and inter-service auth for a solo launch; split only with a recorded reason at scale.                                                                                                                                                                                             |
| Database             | Supabase Postgres                                                                              | Firebase Firestore — rejected because the playbook's migration / index / user-scoped-query discipline maps cleanly to SQL migrations and row-level security, and because a single Postgres schema is easier to audit than Firestore rules + collections. Firebase remains a valid fallback if Supabase free limits bite. |
| Auth                 | Supabase Auth (Google + email)                                                                 | Hand-rolled passwords/sessions — rejected outright by the skill; also Auth.js — rejected for V1 because Supabase Auth is already bundled with the chosen database.                                                                                                                                                       |
| Frontend hosting     | Netlify free                                                                                   | VPS (e.g. a $5–25/month droplet) — rejected for V1: ops cost, patching, and HTTPS work for no benefit at launch scale.                                                                                                                                                                                                   |
| Frontend (V1)        | Server-served static HTML/CSS in the editorial look                                            | React/Vite SPA — rejected for the scaffold step only: it adds a build pipeline before the backend exists. The frontend layer may revisit this with a decision record; the editorial design tokens are framework-independent.                                                                                             |
| Jobs                 | In-monolith scheduled jobs / Supabase scheduled functions (decision deferred to backend layer) | Separate worker service — rejected for V1: another deployable for a handful of daily/hourly jobs.                                                                                                                                                                                                                        |
| Lint / format / test | ESLint flat config, Prettier, `node:test`, `tsc --noEmit`                                      | Vitest/Jest + a separate test runner — rejected for the scaffold: `node:test` needs no extra dependency and proves the health endpoint without a framework. Revisit if test needs grow.                                                                                                                                  |

## 3. Folder structure (scaffold, as built)

```
opiinio/
├── AGENTS.md                  # project memory (Part 0, first)
├── README.md                  # setup steps
├── package.json               # scripts: dev, start, lint, typecheck, test, format
├── tsconfig.json              # strict TypeScript
├── eslint.config.mjs          # ESLint flat config
├── .prettierrc                # formatter config
├── .gitignore                 # env, node_modules, dist, OS/editor files
├── .env.example               # variable NAMES only, every one documented
├── public/
│   ├── index.html             # scaffold landing page (editorial look)
│   └── styles.css             # editorial tokens: cream, ink, teal, coral
├── src/
│   ├── server.ts              # entry point
│   ├── app.ts                 # route table
│   ├── routes/
│   │   └── health.ts          # thin handler
│   ├── services/
│   │   └── healthService.ts   # business logic (health payload)
│   └── lib/
│       └── env.ts             # env validation (names only)
├── tests/
│   └── health.test.ts         # node:test: /api/health, /api/health/live, 404
└── docs/
    ├── system-design.md
    ├── architecture.md        # this file
    └── decisions/
        ├── 0001-modular-monolith.md
        ├── 0002-supabase-over-firebase.md
        ├── 0003-netlify-free-hosting.md
        ├── 0004-no-media-storage-v1.md
        ├── 0005-no-team-invites-v1.md
        └── 0006-editorial-paper-look.md
```

Later layers add (not in this step): `src/db/`, `src/routes/*.ts`
(feature endpoints), `src/services/*.ts` (feature logic),
`src/jobs/`, `migrations/`, `docs/api-conventions.md`,
`docs/permissions.md`, `docs/testing.md`, `docs/hosting.md`,
`docs/caching.md`, `docs/monitoring.md`, `docs/runbooks/`.

## 4. Background jobs (design, not yet built)

- Daily Question rotation: 1 run/day, picks/creates the day's
  question, idempotent by date (running twice on the same date must
  not create a second question).
- Trending-rank recomputation: hourly, from votes/replies in a
  window; reads only, no user writes.
- Notification digests: batched per user per day at most (delivery
  mechanism is a later layer; the digest job itself is not built now).
- All jobs: idempotent, retry with exponential backoff, max retries,
  failures logged with context. Nothing slow runs inside a request.

## 5. Third-party costs: launch vs 10×

Launch (today's scale, text-only, free tiers):

| Service                    | Plan                                            | Cost                                               |
| -------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Netlify hosting            | Free                                            | ₹0                                                 |
| Supabase (Postgres + Auth) | Free                                            | ₹0                                                 |
| Domain                     | Not bought                                      | ₹0 (check + approval required before any purchase) |
| Email (transactional)      | Not wired in V1                                 | ₹0                                                 |
| Error tracking / logs      | Not wired in V1 (later layer; free tiers exist) | ₹0                                                 |
| **Total, launch**          |                                                 | **₹0**                                             |

At 10× the year-1 planning target (see system-design §9: 20,000 MAU
→ 200,000 MAU, ~19 req/s peak → ~190 req/s peak):

- The first cost to appear is the database: Supabase free allows
  500 MB of database. The year-1 estimate already approaches ~1.8 GB
  at 20,000 MAU without archiving, so at 10×, a paid database tier
  (Supabase Pro, from $25/month at the time of writing, with 8 GB
  included) is the expected first paid component — before hosting.
- Netlify free bandwidth is the second watch item: text-only pages
  are tiny, but avatar-less, image-less pages still transfer HTML/CSS;
  bandwidth alerts must be set in the hosting layer.
- Auth: Supabase free allows 50,000 monthly active users; at 200,000
  MAU, auth MAU overage (Pro: $0.00325 per extra MAU at the time of
  writing) becomes a real line item.
- Most expensive component at 10×: **database + auth MAU, not
  hosting**. Mitigations to decide in the scaling layer: archiving /
  aggregating old opinions and votes, cursor pagination everywhere,
  and connection pooling.

All prices above are planning figures from public pricing at the
time of writing, not quotes; the hosting layer must re-verify them
before any upgrade, and billing alerts must be set on every provider
before production.

## 6. Three riskiest decisions

1. **Supabase free limits vs growth.** If the app grows to the
   month-12 planning target, the free database allowance is exceeded
   without archiving (see system-design §9). Risk: a forced paid
   upgrade or a pause. Mitigation: archiving/aggregation decision
   before month 12, billing alerts, and a recorded fallback to
   Firebase if Supabase limits bite earlier.
2. **Anonymous mode + moderation.** Anonymous posts are stored with
   a server-side author id but rendered as "Anonymous". If abuse
   grows before a moderation queue exists, trust is damaged.
   Mitigation: Report/Mute/Block hide content for the reporter in
   V1; a moderation queue is a named later layer and should be built
   before Anonymous scales (see system-design §10, question 5).
3. **Single-instance monolith + free-tier pausing.** Supabase free
   projects pause after inactivity; a single monolith with no
   connection pooling will also struggle under bursts. Mitigation:
   connection pooling, a health endpoint wired to the platform, and
   a keep-alive / staging discipline in the hosting layer — none of
   which are claimed as built in this scaffold step.

## 7. What is deliberately NOT in this step

No auth, no database connection, no migrations, no feature endpoints,
no CI/CD, no staging/production deploys, no security review, no rate
limits, no caching, no error tracking, no monitoring, no load tests.
Those are later layers, in the skill's order, after this report.
