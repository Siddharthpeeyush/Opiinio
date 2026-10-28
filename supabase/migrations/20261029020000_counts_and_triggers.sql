-- Opiinio Layer 3 — Migration 2 of 4: updated_at + stored counts + triggers
--
-- Design choice, stated honestly: counts are RECOUNTED from their
-- source tables on every change (not incremented by +/-1 deltas).
-- A recount cannot drift after a stance change, a block-triggered
-- follow deletion, or a cascade delete. At launch scale (text-only
-- rows, one opinion's votes at a time) that cost is trivial; if a
-- single opinion ever grows a very large vote table, the scaling
-- layer must replace recounts with delta updates and prove it with
-- a before/after load test. Do not silently "optimise" this later
-- without that proof.

-- ---------------------------------------------------------------- updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'profiles', 'daily_questions', 'opinions', 'replies', 'opinion_votes'
  ]) loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I; '
      'create trigger set_updated_at before update on public.%I '
      'for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------- follow counts
-- Stored counts, updated in the SAME transaction as the follow row
-- (system-design §6): never counted by scanning on profile open.
create or replace function public.sync_follow_counts()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
      set following_count = following_count + 1
      where id = new.follower_id;
    update public.profiles
      set follower_count = follower_count + 1
      where id = new.following_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles
      set following_count = greatest(following_count - 1, 0)
      where id = old.follower_id;
    update public.profiles
      set follower_count = greatest(follower_count - 1, 0)
      where id = old.following_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists sync_follow_counts on public.follows;
create trigger sync_follow_counts
  after insert or delete on public.follows
  for each row execute function public.sync_follow_counts();

-- ---------------------------------------------------------------- blocks remove follows both ways
-- The follow deletions above fire sync_follow_counts, so both
-- profiles' counts stay correct in the same transaction.
create or replace function public.remove_follows_on_block()
returns trigger
language plpgsql
as $$
begin
  delete from public.follows
    where (follower_id = new.blocker_id and following_id = new.blocked_id)
       or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists remove_follows_on_block on public.blocks;
create trigger remove_follows_on_block
  after insert on public.blocks
  for each row execute function public.remove_follows_on_block();

-- ---------------------------------------------------------------- opinion counts (recount)
create or replace function public.sync_opinion_vote_counts()
returns trigger
language plpgsql
as $$
declare
  target_id uuid := coalesce(new.opinion_id, old.opinion_id);
begin
  update public.opinions o
    set agree_count = (
          select count(*) from public.opinion_votes
          where opinion_id = target_id and stance = 'agree'),
        neutral_count = (
          select count(*) from public.opinion_votes
          where opinion_id = target_id and stance = 'neutral'),
        disagree_count = (
          select count(*) from public.opinion_votes
          where opinion_id = target_id and stance = 'disagree')
    where o.id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_opinion_vote_counts on public.opinion_votes;
create trigger sync_opinion_vote_counts
  after insert or update or delete on public.opinion_votes
  for each row execute function public.sync_opinion_vote_counts();

create or replace function public.sync_opinion_like_count()
returns trigger
language plpgsql
as $$
declare
  target_id uuid := coalesce(new.opinion_id, old.opinion_id);
begin
  update public.opinions
    set like_count = (
      select count(*) from public.opinion_likes where opinion_id = target_id)
    where id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_opinion_like_count on public.opinion_likes;
create trigger sync_opinion_like_count
  after insert or delete on public.opinion_likes
  for each row execute function public.sync_opinion_like_count();

create or replace function public.sync_opinion_repost_count()
returns trigger
language plpgsql
as $$
declare
  target_id uuid := coalesce(new.opinion_id, old.opinion_id);
begin
  update public.opinions
    set repost_count = (
      select count(*) from public.reposts where opinion_id = target_id)
    where id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_opinion_repost_count on public.reposts;
create trigger sync_opinion_repost_count
  after insert or delete on public.reposts
  for each row execute function public.sync_opinion_repost_count();

create or replace function public.sync_opinion_reply_count()
returns trigger
language plpgsql
as $$
declare
  target_id uuid := coalesce(new.opinion_id, old.opinion_id);
begin
  update public.opinions
    set reply_count = (
      select count(*) from public.replies where opinion_id = target_id)
    where id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_opinion_reply_count on public.replies;
create trigger sync_opinion_reply_count
  after insert or delete on public.replies
  for each row execute function public.sync_opinion_reply_count();

-- ---------------------------------------------------------------- poll + reply-like counts (recount)
create or replace function public.sync_poll_option_vote_count()
returns trigger
language plpgsql
as $$
declare
  target_id uuid := coalesce(new.option_id, old.option_id);
begin
  update public.poll_options
    set vote_count = (
      select count(*) from public.poll_votes where option_id = target_id)
    where id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_poll_option_vote_count on public.poll_votes;
create trigger sync_poll_option_vote_count
  after insert or delete on public.poll_votes
  for each row execute function public.sync_poll_option_vote_count();

-- V1 Voice Score = reply like count (see migration 01). A richer
-- scoring rule (e.g. weighting replies, debate wins) is a later
-- decision; it must be recorded before this trigger is changed.
create or replace function public.sync_reply_voice_score()
returns trigger
language plpgsql
as $$
declare
  target_id uuid := coalesce(new.reply_id, old.reply_id);
begin
  update public.replies
    set voice_score = (
      select count(*) from public.reply_likes where reply_id = target_id)
    where id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_reply_voice_score on public.reply_likes;
create trigger sync_reply_voice_score
  after insert or delete on public.reply_likes
  for each row execute function public.sync_reply_voice_score();
