# 0007 — Layer 3 database: Supabase Postgres migrations, RLS, recount triggers

Status: Accepted for V1 (Layer 3 only). No auth endpoints, no feature
APIs, no frontend change, no live database write in this step.

## Context

Part 0 locked Supabase free (Postgres + Auth) over Firebase. Layer 3
turns that into versioned SQL: 18 tables covering the prototype's V1
data needs (profiles, opinions, replies, stance votes, likes, reposts,
follows, text-only polls, bookmarks, respect-filter tables, reports,
notifications, daily questions). Tenancy is per personal `user_id`;
there are no organisations or teams.

## Decision

- Migrations live in `supabase/migrations/` in four ordered files
  (core tables, counts/triggers, indexes, RLS), applied in the
  Supabase SQL Editor by the user (see `MIGRATION-GUIDE.md`). The
  `supabase/` folder is the Supabase CLI convention; the architecture
  doc's later-layer `migrations/` note is superseded by this record
  for the actual location.
- Stored counts (stance split, likes, reposts, replies, poll votes,
  follow counts, reply Voice Score) are RECOUNTED from source tables
  on change, not delta-incremented. Recounts cannot drift after a
  stance change or a block-triggered follow deletion; the cost at
  launch scale is trivial, and replacing them with deltas is a
  scaling-layer job with a before/after load test.
- V1 Voice Score = reply like count. A richer rule is deferred and
  must be recorded before the trigger changes.
- Poll votes have no UPDATE policy: a cast vote is locked; DELETE
  (undo) is allowed. Stance votes, by contrast, allow UPDATE (a user
  may change Agree/Neutral/Disagree).
- One repost per user per opinion (unique pair); plain = quote_take
  NULL, Quote Repost = quote_take <= 280 chars.
- Health check reports the database as `not_configured` (vars
  missing) or `not_checked` (vars present, no client yet). It never
  reports `ok` in this layer, because no live probe exists yet.

## Alternatives considered

- Delta (+1/-1) count updates: rejected for V1 — faster under huge
  load, but drifts on stance changes and cascade deletes, and the
  drift would be silent.
- One generic `likes` table with nullable opinion/reply columns:
  rejected — two tables with composite PKs enforce one-like-per-user
  per target in the database, with no nullable-target ambiguity.
- A `topics` table with a foreign key from opinions: rejected for V1
  — topics are free text (<= 50 chars) so new topics need no schema
  change; Explore ranking aggregates opinions by topic in a later
  layer.

## Consequences and honest limits

- RLS is enabled on all 18 tables with user-scoped write policies.
  BUT: RLS alone does NOT anonymise anonymous posts. A public SELECT
  policy on opinions means a direct table reader can see author_id.
  The API layer MUST mask anonymous authors as "Anonymous" in every
  response, and direct table access must never be the app's read path
  for anonymous posts. This is not a footnote — it is a Layer 5
  requirement, and the test suite does not (and cannot, from files
  alone) prove live RLS behaviour.
- Live proof is outstanding: the migrations have not been applied to
  the user's Supabase project yet, and no backup/restore test has
  been run. Both are listed as skipped in the Layer 3 report and
  must happen before any feature endpoint is called done.
- No media tables, no premium/billing tables, no money columns in
  this layer. If a money column appears later, it must be integer
  paise, never a float.
