-- Opiinio Layer 3 — Migration 3 of 4: indexes
--
-- Rule from the playbook: an index for every foreign key and every
-- column the app filters or sorts by. Feed queries sort by
-- created_at desc, filter by topic / author / following; lookup
-- queries filter by handle, poll, and report target.

-- Profiles / lookups
create index if not exists profiles_handle_idx
  on public.profiles (handle);
create index if not exists profiles_pinned_opinion_idx
  on public.profiles (pinned_opinion_id)
  where pinned_opinion_id is not null;

-- Feed: newest first, per topic, per author
create index if not exists opinions_created_at_idx
  on public.opinions (created_at desc);
create index if not exists opinions_topic_created_at_idx
  on public.opinions (topic, created_at desc);
create index if not exists opinions_author_created_at_idx
  on public.opinions (author_id, created_at desc);
create index if not exists opinions_daily_question_idx
  on public.opinions (daily_question_id)
  where daily_question_id is not null;
create index if not exists opinions_anonymous_created_at_idx
  on public.opinions (is_anonymous, created_at desc);

-- Replies on an opinion, newest first and by side (Debate Mode)
create index if not exists replies_opinion_created_at_idx
  on public.replies (opinion_id, created_at desc);
create index if not exists replies_opinion_side_idx
  on public.replies (opinion_id, side, created_at desc);
create index if not exists replies_author_created_at_idx
  on public.replies (author_id, created_at desc);

-- Votes / likes / reposts / follows: both directions of each pair
create index if not exists opinion_votes_opinion_idx
  on public.opinion_votes (opinion_id);
create index if not exists opinion_likes_opinion_idx
  on public.opinion_likes (opinion_id);
create index if not exists opinion_likes_user_idx
  on public.opinion_likes (user_id, created_at desc);
create index if not exists reply_likes_reply_idx
  on public.reply_likes (reply_id);
create index if not exists reposts_opinion_idx
  on public.reposts (opinion_id, created_at desc);
create index if not exists reposts_user_idx
  on public.reposts (user_id, created_at desc);
create index if not exists follows_follower_idx
  on public.follows (follower_id, created_at desc);
create index if not exists follows_following_idx
  on public.follows (following_id, created_at desc);

-- Polls
create index if not exists poll_options_poll_position_idx
  on public.poll_options (poll_id, position);
create index if not exists poll_votes_poll_idx
  on public.poll_votes (poll_id);
create index if not exists poll_votes_option_idx
  on public.poll_votes (option_id);

-- Bookmarks / respect filter / reports / notifications
create index if not exists bookmarks_user_idx
  on public.bookmarks (user_id, created_at desc);
create index if not exists blocks_blocker_idx
  on public.blocks (blocker_id);
create index if not exists blocks_blocked_idx
  on public.blocks (blocked_id);
create index if not exists reports_opinion_idx
  on public.reports (opinion_id)
  where opinion_id is not null;
create index if not exists reports_reply_idx
  on public.reports (reply_id)
  where reply_id is not null;
create index if not exists notifications_user_created_at_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where is_read = false;
create index if not exists daily_questions_date_idx
  on public.daily_questions (question_date desc);

-- One report per user per target (partial unique indexes; NULLs in
-- the other target column must not defeat the uniqueness).
create unique index if not exists reports_one_per_opinion_idx
  on public.reports (reporter_id, opinion_id)
  where opinion_id is not null;
create unique index if not exists reports_one_per_reply_idx
  on public.reports (reporter_id, reply_id)
  where reply_id is not null;
