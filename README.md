# Opiinio — Real Product Scaffold

**Opiinio (O-P-I-I-N-I-O) — EVERY OPINION MATTERS.** A text-only
opinion platform: write opinions in 280 characters, reply, vote
Agree / Neutral / Disagree, repost, debate, and follow — with no
photo, video, or media upload anywhere, and initials-only avatars
at launch.

> This is the REAL product scaffold (Part 0 + scaffold, per the
> `real_saas_playbook` skill). It is NOT the demo prototype artifact
> (`opinion-app-prototype`), which keeps in-memory state and resets
> on reload. No accounts, database, auth, or feature endpoints exist
> yet in this step — those are the next layers.

## Quick start

```sh
npm install
cp .env.example .env   # placeholders only; the scaffold starts without it
npm run dev            # http://localhost:3000
```

Then open http://localhost:3000/ for the editorial-paper landing
page, and http://localhost:3000/api/health for the health check.

## Commands

| Command                | What it does                                  |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Build, then start the server with watch       |
| `npm start`            | Start the built server (`dist/src/server.js`) |
| `npm run lint`         | ESLint over `src/` and `tests/`               |
| `npm run typecheck`    | `tsc --noEmit` (strict)                       |
| `npm test`             | Build, then run the `node:test` suite         |
| `npm run format`       | Prettier over the repo                        |
| `npm run format:check` | Prettier check (no writes)                    |

## Project layout

See `docs/architecture.md` §3 for the full folder structure and
`AGENTS.md` for the project memory, hard rules, and decisions.
Business logic lives in `src/services/` only — never in route
handlers or UI.

## Environment

See `.env.example` for every variable, documented. In this scaffold
step no variable is required: Supabase is not wired yet, so the
server starts without env. When the next layer wires Supabase,
`SUPABASE_URL` and `SUPABASE_ANON_KEY` become required and the
server must refuse to start without them (see `src/lib/env.ts`).

**Never commit `.env`, never put a real secret in code, and never
put the Supabase service-role key in client code.**

## Next layers (not built yet)

1. Database migrations + Supabase Auth (Google + email, no SMS OTP)
2. Validated APIs with central permission checks, user-scoped queries
3. Editorial frontend screens with loading/empty/error states
4. Tests (incl. cross-user access), CI/CD, staging/production
5. Security review, rate limits, caching, logs/error tracking,
   monitoring, load/cost checks, legal pages

Each layer follows the skill's loop: plan → review → small steps →
lint + typecheck + tests → diff review → record the decision — and
the don't-fool-me check before anything is called done.

## User-owned steps (not done by this scaffold)

- Create the GitHub repo yourself (GitHub Apps cannot create user
  repos via API), then grant the app access, then the scaffold can
  be pushed.
- Create the free Supabase project yourself on your own account.
- Custom domain: availability not checked, nothing bought — needs a
  separate approval plus the exact checkout price.
