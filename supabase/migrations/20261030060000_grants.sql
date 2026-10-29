-- Opiinio — Migration 6 of 6: table privileges for anon / authenticated
--
-- WHY THIS EXISTS (outage post-mortem, 2026-10-30):
-- Migrations 01–05 created the tables and the RLS policies, but never
-- GRANTed table privileges to the anon and authenticated roles. Tables
-- created by the postgres superuser carry no grants by default, so every
-- PostgREST call failed with Postgres 42501 "permission denied for table",
-- which PostgREST surfaces as HTTP 401. The Supabase API logs proved the
-- service key was valid and accepted at the gateway — the missing GRANT
-- was the entire outage, and the live site's /api/* returned 503 for it.
-- Lesson recorded in docs/decisions/0021-grants-outage.md: verifying
-- "RLS enabled" is not enough; a live read must be part of migration
-- verification.
--
-- SAFETY: GRANTs do not bypass RLS. The policies in migration 04 remain
-- the real enforcement (public reads, owner-only writes, own-rows-only
-- private tables). This only lets anon/authenticated REACH the policy
-- check instead of being denied at the table door.
--
-- Least privilege, mirroring the policies:
--   anon          -> SELECT only (policies grant anon no writes anywhere)
--   authenticated -> SELECT, INSERT, UPDATE, DELETE (policies then
--                    restrict writes to the caller's own rows)
--
-- NOTE on alter default privileges: these apply to tables created by the
-- role that runs this migration (postgres in the SQL Editor). If a future
-- migration is ever applied by a different role, re-run the grant block
-- below for its tables.

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'profiles', 'daily_questions', 'opinions', 'replies',
    'opinion_votes', 'opinion_likes', 'reply_likes', 'reposts',
    'follows', 'polls', 'poll_options', 'poll_votes', 'bookmarks',
    'muted_topics', 'muted_words', 'blocks', 'reports', 'notifications'
  ]) loop
    execute format('grant select on public.%I to anon', t);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated', t
    );
  end loop;
end;
$$;

alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
