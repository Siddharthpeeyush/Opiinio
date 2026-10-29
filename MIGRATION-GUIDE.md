# Opiinio — Applying the Layer 3 migrations

Project: **opiinio** — https://moahibzipoyyheaceonp.supabase.co
Status: Healthy, **no migrations yet** (your dashboard screenshot).
This guide turns that into "migrations applied". It needs only your
dashboard taps — no key is shared with the assistant, and no code in
this repo contains a key.

## What NOT to do

- **Do not connect the GitHub field.** Your dashboard shows
  "GitHub: No repository connected" — that is fine and is NOT needed.
  The repo connection is for Supabase's GitHub integration; our
  migrations are applied by pasting SQL below, and the code is pushed
  to GitHub separately. Connecting it adds nothing for V1 and can
  confuse the two flows. Leave it as "No repository connected".
- **Do not paste the service_role key anywhere**, and do not send
  it (or your database password) in chat. The SQL Editor runs as
  your project owner, so it does not need any key.
- **Do not edit the migration files by hand** to "fix" an error.
  If a step fails, stop and report the exact error message — a
  hand-edited database is exactly what migrations exist to prevent.

## Step 1 — Open the SQL Editor

1. Open your Supabase project dashboard.
2. In the left sidebar, click **SQL Editor**.
3. Click **New query**.

## Step 2 — Run the four migrations, in this exact order

For each file, open it from this repo, copy its entire contents,
paste into a new SQL Editor query, and click **Run**. Wait for
"Success" before starting the next file. Do not run them out of
order — triggers in file 02 reference tables from file 01, and RLS
in file 04 references everything before it.

| Order | File                                                         | What it creates                                                           |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 1     | `supabase/migrations/20261029010000_core_tables.sql`         | 18 tables, 280-char checks, composite keys, self-follow/self-block checks |
| 2     | `supabase/migrations/20261029020000_counts_and_triggers.sql` | `updated_at` triggers, stored-count recounts, block-removes-follow        |
| 3     | `supabase/migrations/20261029030000_indexes.sql`             | Feed, topic, author, follow, poll, and report indexes                     |
| 4     | `supabase/migrations/20261029040000_rls.sql`                 | RLS enabled on all 18 tables + user-scoped policies                       |

If a file says "Success" but you are unsure it ran, re-running it
is safe: tables use `IF NOT EXISTS`, triggers are dropped and
re-created, and policies are dropped and re-created.

## Step 3 — Verify (this is the proof, not the "Success" banner)

Run these in the SQL Editor. Every query must return the expected
result; if any does not, stop and report it.

```sql
-- 1. All 18 tables exist.
select table_name from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
-- Expect: blocks, bookmarks, daily_questions, follows, muted_topics,
-- muted_words, notifications, opinion_likes, opinion_votes, opinions,
-- poll_options, poll_votes, polls, profiles, reply_likes, reposts,
-- reports, replies (18 rows).

-- 2. RLS is on for every table.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
-- Expect: rowsecurity = true for all 18 tables.

-- 3. Every table has at least one policy.
select tablename, count(*) as policies from pg_policies
where schemaname = 'public' group by tablename order by tablename;
-- Expect: 18 rows, each with policies >= 1.

-- 4. The 280-char check exists on opinions.
select conname from pg_constraint
where conrelid = 'public.opinions'::regclass;
-- Expect: a check constraint mentioning body (char_length <= 280).
```

After step 3, your project overview will no longer say
"No migrations" in the sense that matters — Supabase's dashboard
"Last migration" field only tracks migrations applied through its
GitHub/CLI integration, so it may still read "No migrations" even
after a successful SQL-Editor apply. **That field is not the proof.**
The four queries above are the proof: tables + RLS + policies
present in your live database. Do not chase the dashboard label.

## Step 4 (optional, seed data for testing only)

`supabase/seed.sql` is **not** a migration and is **not** for
production. To use it:

1. Dashboard > Authentication > Users: create two users.
2. Copy their UUIDs and replace `USER_A_ID` / `USER_B_ID` in the
   seed file (do not run it unedited — the foreign keys will fail).
3. Run it in the SQL Editor, then run its verification queries at
   the bottom of the file: Meera must show `follower_count 1`,
   Arya `following_count 1`, and the seeded opinion must show
   agree 1, like 1, repost 1, reply 1. If any count is 0, a trigger
   did not fire — report it, do not hand-edit the counts.
4. Delete the seed users (and their rows) before launch.

## Standing rule: verify with a live read, not just the dashboard

After ANY migration is applied live — including this grants migration —
run one unauthenticated read against a public table before calling it
verified, e.g. in the SQL Editor's API preview or with curl:

```sql
-- as the anon role: must return rows (or zero rows), never 42501
set role anon;
select id from public.opinions limit 1;
reset role;
```

"RLS enabled" on the dashboard is not proof the API path works. The
2026-10-30 outage proved it: tables + policies were all present, but the
missing GRANTs made every PostgREST call fail with 42501 (surfaced as
HTTP 401), and only a live read would have caught it. See
docs/decisions/0021-grants-outage.md.

## What is still NOT done after this guide

- **Live cross-user proof:** the file tests in this repo prove the
  SQL _says_ the right things; they do not prove a second signed-in
  user is actually blocked live. That proof is a Layer 4 test
  (two real Auth users, one requesting the other's private row).
- **Backup + tested restore:** not run. Supabase free includes
  backups, but a restore into a separate project has not been
  tested — that is a later-layer checklist item, not a claim here.
- **Anonymous masking:** RLS alone does not hide `author_id` on
  anonymous posts (see the header of migration 04). The API layer
  must mask anonymous authors as "Anonymous" in every response.
  Until that layer exists, do not expose direct table reads to users.
- **Env wiring:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` are still
  placeholders in `.env.example`. They become real (in a local
  `.env`, never committed) only when the client is wired in a later
  layer. The anon key is the client-safe key; the service_role key
  is never put in this repo.
