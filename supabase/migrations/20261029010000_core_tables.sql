-- Opiinio Layer 3 — Migration 1 of 4: core tables (V1)
--
-- Apply in order: 01 core tables, 02 counts/triggers, 03 indexes, 04 RLS.
-- Re-runnable in the Supabase SQL Editor: tables use IF NOT EXISTS and
-- the pinned-opinion column is added only if missing. This is a
-- convenience for the SQL-Editor flow in MIGRATION-GUIDE.md; in a
-- Supabase CLI workflow these files are applied once, in order.
--
-- Tenancy: personal accounts only, no organisations, no teams.
-- Every user-owned row carries a user id scoped by RLS in migration 04.
-- There are NO media tables in V1: text-only, 280 characters, initials
-- only. No premium/billing tables in this layer.
--
-- Anonymous-post warning (honest, see migration 04 and the guide):
-- author_id is stored server-side for moderation and for the author's
-- own list. RLS alone cannot hide author_id from a reader who can
-- SELECT the row, so the later API layer MUST mask anonymous authors
-- as "Anonymous" before returning an opinion. Do not claim RLS solves
-- that on its own.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique
    check (handle ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 80),
  bio text
    check (bio is null or char_length(bio) <= 280),
  follower_count integer not null default 0 check (follower_count >= 0),
  following_count integer not null default 0 check (following_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- daily questions
-- One question per calendar date. Answers are opinions that reference
-- the question; the API layer badges them as Daily answers (Layer 5+).
create table if not exists public.daily_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null
    check (char_length(question) between 1 and 280),
  question_date date not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- opinions
create table if not exists public.opinions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null
    check (char_length(body) between 1 and 280),
  topic text not null
    check (char_length(topic) between 1 and 50),
  is_anonymous boolean not null default false,
  daily_question_id uuid references public.daily_questions (id)
    on delete set null,
  agree_count integer not null default 0 check (agree_count >= 0),
  neutral_count integer not null default 0 check (neutral_count >= 0),
  disagree_count integer not null default 0 check (disagree_count >= 0),
  like_count integer not null default 0 check (like_count >= 0),
  repost_count integer not null default 0 check (repost_count >= 0),
  reply_count integer not null default 0 check (reply_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pinned opinion (added after opinions exists, to avoid a circular
-- CREATE TABLE reference). A pinned opinion must belong to the profile.
alter table public.profiles
  add column if not exists pinned_opinion_id uuid
    references public.opinions (id) on delete set null;

-- ---------------------------------------------------------------- replies
-- side: for / against / neutral, matching Debate Mode (For vs Against
-- columns, with Neutral replies shown unfiltered).
create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  opinion_id uuid not null references public.opinions (id)
    on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null
    check (char_length(body) between 1 and 280),
  side text not null default 'neutral'
    check (side in ('for', 'against', 'neutral')),
  -- V1 Voice Score = number of likes on the reply (see migration 02).
  -- A richer scoring rule is a later-layer decision, not hidden here.
  voice_score integer not null default 0 check (voice_score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- stance votes
-- One stance per user per opinion, enforced by the composite PK.
-- Changing stance = UPDATE the row (migration 02 recounts the counts).
create table if not exists public.opinion_votes (
  user_id uuid not null references auth.users (id) on delete cascade,
  opinion_id uuid not null references public.opinions (id)
    on delete cascade,
  stance text not null
    check (stance in ('agree', 'neutral', 'disagree')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, opinion_id)
);

-- ---------------------------------------------------------------- likes
-- Separate tables for opinions and replies: each has its own composite
-- PK, so "one like per user per target" is a database guarantee.
create table if not exists public.opinion_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  opinion_id uuid not null references public.opinions (id)
    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, opinion_id)
);

create table if not exists public.reply_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  reply_id uuid not null references public.replies (id)
    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, reply_id)
);

-- ---------------------------------------------------------------- reposts
-- One repost per user per opinion (composite UNIQUE). A plain repost
-- has quote_take NULL; a Quote Repost has quote_take <= 280 chars.
create table if not exists public.reposts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  opinion_id uuid not null references public.opinions (id)
    on delete cascade,
  quote_take text
    check (quote_take is null or char_length(quote_take) between 1 and 280),
  created_at timestamptz not null default now(),
  unique (user_id, opinion_id)
);

-- ---------------------------------------------------------------- follows
-- Public instant follow (locked decision). One small record per follow,
-- never a list inside a profile row. No self-follow, enforced here.
create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- ---------------------------------------------------------------- polls (text-only)
-- One poll per opinion. Options are short text only, no media.
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  opinion_id uuid not null unique references public.opinions (id)
    on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_text text not null
    check (char_length(option_text) between 1 and 80),
  position integer not null default 0 check (position >= 0),
  vote_count integer not null default 0 check (vote_count >= 0),
  created_at timestamptz not null default now()
);

-- One vote per user per poll, enforced by the composite PK.
-- No UPDATE policy in migration 04: a vote is locked once cast;
-- deleting (undo) is allowed, casting a second vote is not.
create table if not exists public.poll_votes (
  user_id uuid not null references auth.users (id) on delete cascade,
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_id uuid not null references public.poll_options (id)
    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, poll_id)
);

-- ---------------------------------------------------------------- bookmarks
create table if not exists public.bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade,
  opinion_id uuid not null references public.opinions (id)
    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, opinion_id)
);

-- ---------------------------------------------------------------- respect filter
create table if not exists public.muted_topics (
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null
    check (char_length(topic) between 1 and 50),
  created_at timestamptz not null default now(),
  primary key (user_id, topic)
);

create table if not exists public.muted_words (
  user_id uuid not null references auth.users (id) on delete cascade,
  word text not null
    check (char_length(word) between 1 and 50),
  created_at timestamptz not null default now(),
  primary key (user_id, word)
);

-- Blocking removes the follow both ways (migration 02 trigger).
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------- reports
-- Exactly one target per report. Partial unique indexes (migration 03)
-- stop the same user reporting the same post twice.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  opinion_id uuid references public.opinions (id) on delete cascade,
  reply_id uuid references public.replies (id) on delete cascade,
  reason text not null
    check (char_length(reason) between 1 and 280),
  created_at timestamptz not null default now(),
  check (
    (opinion_id is not null and reply_id is null)
    or (opinion_id is null and reply_id is not null)
  )
);

-- ---------------------------------------------------------------- notifications
-- List only in V1 (All / Mentions / Replies / Updates). Delivery is a
-- later layer; rows are created by the server (service role) in that
-- layer, never by direct user INSERT (no INSERT policy in migration 04).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  type text not null
    check (type in ('mention', 'reply', 'update')),
  opinion_id uuid references public.opinions (id) on delete cascade,
  reply_id uuid references public.replies (id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
