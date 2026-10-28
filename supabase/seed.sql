-- Opiinio — SEED ONLY. This is NOT a migration. Do NOT apply it
-- before the four files in supabase/migrations/ have been applied,
-- and do NOT run it as-is.
--
-- Why it cannot run as-is: profiles.id and every author_id are
-- foreign keys to auth.users(id). The two seed users must exist in
-- Supabase Auth FIRST. Steps:
--   1. In the Supabase dashboard, go to Authentication > Users and
--      create two users (any email + password you choose; e.g.
--      seed-arya@example.com and seed-meera@example.com).
--   2. Copy each user's UUID from that same Users table.
--   3. Replace USER_A_ID and USER_B_ID below with those UUIDs.
--   4. Run this file in the SQL Editor, then delete the seed rows
--      (or the two Auth users) before launch — seed data is for
--      local verification only, never for production.
--
-- What it proves, once run: two users, one follow (A follows B),
-- two opinions (one with a poll, one anonymous), one reply, one
-- stance vote, one like, one repost, one bookmark. Follower counts
-- are set by the migration-02 triggers, not by this file, so after
-- running it, B's follower_count must read 1 and A's
-- following_count must read 1 — if they read 0, a trigger did not
-- fire and the migration must be re-checked, not hand-edited.

begin;

insert into public.profiles (id, handle, display_name, bio) values
  ('USER_A_ID', 'arya', 'Arya', 'Seed user A — delete before launch.'),
  ('USER_B_ID', 'meera', 'Meera', 'Seed user B — delete before launch.')
  on conflict (id) do nothing;

insert into public.follows (follower_id, following_id) values
  ('USER_A_ID', 'USER_B_ID')
  on conflict do nothing;

insert into public.opinions (id, author_id, body, topic, is_anonymous) values
  ('11111111-1111-4111-8111-111111111111', 'USER_B_ID',
   'Remote work should be the default, not a perk.', 'Work', false),
  ('22222222-2222-4222-8222-222222222222', 'USER_A_ID',
   'Skills beat degrees when the work is real.', 'Work', true)
  on conflict (id) do nothing;

insert into public.polls (id, opinion_id) values
  ('33333333-3333-4333-8333-333333333333',
   '11111111-1111-4111-8111-111111111111')
  on conflict (id) do nothing;

insert into public.poll_options (id, poll_id, option_text, position) values
  ('44444444-4444-4444-8444-444444444444',
   '33333333-3333-4333-8333-333333333333', 'Default', 0),
  ('55555555-5555-4555-8555-555555555555',
   '33333333-3333-4333-8333-333333333333', 'Office first', 1)
  on conflict (id) do nothing;

insert into public.replies (id, opinion_id, author_id, body, side) values
  ('66666666-6666-4666-8666-666666666666',
   '11111111-1111-4111-8111-111111111111', 'USER_A_ID',
   'Agree — but only with clear written async norms.', 'for')
  on conflict (id) do nothing;

insert into public.opinion_votes (user_id, opinion_id, stance) values
  ('USER_A_ID', '11111111-1111-4111-8111-111111111111', 'agree')
  on conflict do nothing;

insert into public.opinion_likes (user_id, opinion_id) values
  ('USER_A_ID', '11111111-1111-4111-8111-111111111111')
  on conflict do nothing;

insert into public.reposts (user_id, opinion_id, quote_take) values
  ('USER_A_ID', '11111111-1111-4111-8111-111111111111',
   'Exactly this. Skills beat degrees when the work is real.')
  on conflict do nothing;

insert into public.bookmarks (user_id, opinion_id) values
  ('USER_A_ID', '11111111-1111-4111-8111-111111111111')
  on conflict do nothing;

commit;

-- Verification queries (run after the seed, expect these results):
--   select handle, follower_count, following_count from public.profiles;
--     -> meera: follower_count 1, following_count 0
--     -> arya:  follower_count 0, following_count 1
--   select agree_count, like_count, repost_count, reply_count
--     from public.opinions
--     where id = '11111111-1111-4111-8111-111111111111';
--     -> agree 1, like 1, repost 1, reply 1
