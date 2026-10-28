-- Opiinio Layer 3 — Migration 4 of 4: Row Level Security + policies
--
-- Every table in migration 01 gets RLS enabled here. "Public" below
-- means the anon + authenticated roles (a visitor can read public
-- opinions, topics, and profiles; only a signed-in user can write).
-- Write policies are always scoped to auth.uid() = the owner id,
-- never to another user's id. No policy grants UPDATE/DELETE on
-- another user's row, and no policy grants INSERT as another user.
--
-- ANONYMOUS-POST CAVEAT — read this before claiming RLS is enough:
-- RLS grants SELECT on opinions to the public, so a reader who can
-- query the table directly can see author_id on an anonymous row.
-- That is why the API layer (Layer 5) MUST strip/mask author_id and
-- render anonymous opinions as "Anonymous" in every response, and
-- why direct table access must never be the app's read path for
-- anonymous posts. RLS protects writes and private tables; it does
-- NOT by itself anonymise a public read. This limitation is recorded
-- in MIGRATION-GUIDE.md and in docs/decisions/0007-layer3-database.md.
--
-- Service role note: Supabase's service_role bypasses RLS. It is
-- never used in client code and is never stored in this repo. The
-- only rows a regular user cannot INSERT (daily_questions,
-- notifications) are created by the server with the service role
-- in a later layer.

-- Helper: enable RLS on all V1 tables in one place, so a future
-- table cannot be added without this list being updated (and the
-- test in tests/database.test.ts failing until it is).
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
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- profiles
drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select to anon, authenticated using (true);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete to authenticated using (auth.uid() = id);

-- ---------------------------------------------------------------- daily questions: read-only for users
drop policy if exists daily_questions_select_public on public.daily_questions;
create policy daily_questions_select_public on public.daily_questions
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- opinions
drop policy if exists opinions_select_public on public.opinions;
create policy opinions_select_public on public.opinions
  for select to anon, authenticated using (true);
drop policy if exists opinions_insert_own on public.opinions;
create policy opinions_insert_own on public.opinions
  for insert to authenticated with check (auth.uid() = author_id);
drop policy if exists opinions_update_own on public.opinions;
create policy opinions_update_own on public.opinions
  for update to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);
drop policy if exists opinions_delete_own on public.opinions;
create policy opinions_delete_own on public.opinions
  for delete to authenticated using (auth.uid() = author_id);

-- ---------------------------------------------------------------- replies
drop policy if exists replies_select_public on public.replies;
create policy replies_select_public on public.replies
  for select to anon, authenticated using (true);
drop policy if exists replies_insert_own on public.replies;
create policy replies_insert_own on public.replies
  for insert to authenticated with check (auth.uid() = author_id);
drop policy if exists replies_update_own on public.replies;
create policy replies_update_own on public.replies
  for update to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);
drop policy if exists replies_delete_own on public.replies;
create policy replies_delete_own on public.replies
  for delete to authenticated using (auth.uid() = author_id);

-- ---------------------------------------------------------------- opinion votes: private per user
drop policy if exists opinion_votes_select_own on public.opinion_votes;
create policy opinion_votes_select_own on public.opinion_votes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists opinion_votes_insert_own on public.opinion_votes;
create policy opinion_votes_insert_own on public.opinion_votes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists opinion_votes_update_own on public.opinion_votes;
create policy opinion_votes_update_own on public.opinion_votes
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists opinion_votes_delete_own on public.opinion_votes;
create policy opinion_votes_delete_own on public.opinion_votes
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------- likes / reposts / follows: public reads, own writes
drop policy if exists opinion_likes_select_public on public.opinion_likes;
create policy opinion_likes_select_public on public.opinion_likes
  for select to anon, authenticated using (true);
drop policy if exists opinion_likes_insert_own on public.opinion_likes;
create policy opinion_likes_insert_own on public.opinion_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists opinion_likes_delete_own on public.opinion_likes;
create policy opinion_likes_delete_own on public.opinion_likes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists reply_likes_select_public on public.reply_likes;
create policy reply_likes_select_public on public.reply_likes
  for select to anon, authenticated using (true);
drop policy if exists reply_likes_insert_own on public.reply_likes;
create policy reply_likes_insert_own on public.reply_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists reply_likes_delete_own on public.reply_likes;
create policy reply_likes_delete_own on public.reply_likes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists reposts_select_public on public.reposts;
create policy reposts_select_public on public.reposts
  for select to anon, authenticated using (true);
drop policy if exists reposts_insert_own on public.reposts;
create policy reposts_insert_own on public.reposts
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists reposts_delete_own on public.reposts;
create policy reposts_delete_own on public.reposts
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists follows_select_public on public.follows;
create policy follows_select_public on public.follows
  for select to anon, authenticated using (true);
drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert to authenticated with check (auth.uid() = follower_id);
drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete to authenticated
  using (auth.uid() = follower_id or auth.uid() = following_id);

-- ---------------------------------------------------------------- polls: public reads, author-only creation
drop policy if exists polls_select_public on public.polls;
create policy polls_select_public on public.polls
  for select to anon, authenticated using (true);
drop policy if exists polls_insert_opinion_author on public.polls;
create policy polls_insert_opinion_author on public.polls
  for insert to authenticated with check (
    exists (
      select 1 from public.opinions o
      where o.id = opinion_id and o.author_id = auth.uid()
    )
  );
drop policy if exists polls_delete_opinion_author on public.polls;
create policy polls_delete_opinion_author on public.polls
  for delete to authenticated using (
    exists (
      select 1 from public.opinions o
      where o.id = opinion_id and o.author_id = auth.uid()
    )
  );

drop policy if exists poll_options_select_public on public.poll_options;
create policy poll_options_select_public on public.poll_options
  for select to anon, authenticated using (true);
drop policy if exists poll_options_insert_opinion_author on public.poll_options;
create policy poll_options_insert_opinion_author on public.poll_options
  for insert to authenticated with check (
    exists (
      select 1 from public.polls p
      join public.opinions o on o.id = p.opinion_id
      where p.id = poll_id and o.author_id = auth.uid()
    )
  );

-- Poll votes: private per user, one vote per poll (composite PK).
-- No UPDATE policy: a cast vote is locked; DELETE (undo) is allowed.
drop policy if exists poll_votes_select_own on public.poll_votes;
create policy poll_votes_select_own on public.poll_votes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists poll_votes_insert_own on public.poll_votes;
create policy poll_votes_insert_own on public.poll_votes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists poll_votes_delete_own on public.poll_votes;
create policy poll_votes_delete_own on public.poll_votes
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------- bookmarks / respect filter / reports: own only
drop policy if exists bookmarks_select_own on public.bookmarks;
create policy bookmarks_select_own on public.bookmarks
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists bookmarks_insert_own on public.bookmarks;
create policy bookmarks_insert_own on public.bookmarks
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists bookmarks_delete_own on public.bookmarks;
create policy bookmarks_delete_own on public.bookmarks
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists muted_topics_all_own on public.muted_topics;
create policy muted_topics_all_own on public.muted_topics
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists muted_words_all_own on public.muted_words;
create policy muted_words_all_own on public.muted_words
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists blocks_all_own on public.blocks;
create policy blocks_all_own on public.blocks
  for all to authenticated
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated using (auth.uid() = reporter_id);
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);
drop policy if exists reports_delete_own on public.reports;
create policy reports_delete_own on public.reports
  for delete to authenticated using (auth.uid() = reporter_id);

-- ---------------------------------------------------------------- notifications: read + mark-read, own only
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
