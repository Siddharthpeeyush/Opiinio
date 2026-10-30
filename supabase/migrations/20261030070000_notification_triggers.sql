-- Migration 07 — notification creation triggers (decision 0023).
--
-- The API deliberately never creates notifications (no POST route;
-- createNotificationServerOnly() throws by design) because creation
-- must not depend on a service key living in the app repo. Instead,
-- Postgres triggers create them server-side: the trigger functions
-- are SECURITY DEFINER, so they bypass RLS on public.notifications
-- (which has no INSERT policy for anon/authenticated in migration 04)
-- without any key material anywhere in the codebase.
--
-- Rules, applied uniformly:
--   * never notify a user about their own action (self-like etc.)
--   * never notify when the recipient blocked the actor
--   * actor_id is stored raw; anonymous masking happens at READ time
--     (listNotifications masks the actor when the linked opinion is
--     anonymous), so triggers stay simple and the privacy rule
--     (masking in every response path) keeps holding.
--
-- Events covered: follow, reply, opinion like, reply like, repost.
-- Poll votes are intentionally quiet (too noisy at scale).

-- 1. Widen the notification type check to the event types we emit.
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('follow', 'reply', 'like', 'repost', 'mention', 'update'));

-- 2. Shared guard: true when a notification should be suppressed.
create or replace function public.should_suppress_notification(
  recipient_id uuid,
  actor_id uuid
) returns boolean
language sql
stable
set search_path = public
as $$
  select recipient_id = actor_id
      or exists (
           select 1
           from public.blocks
           where blocker_id = recipient_id
             and blocked_id = actor_id
         );
$$;

-- 3a. New follower -> notify the followed user.
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.should_suppress_notification(new.following_id, new.follower_id) then
    return null;
  end if;
  insert into public.notifications (user_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return null;
end;
$$;

-- 3b. New reply -> notify the opinion author.
create or replace function public.notify_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opinion_author uuid;
begin
  select author_id into opinion_author
  from public.opinions
  where id = new.opinion_id;
  if opinion_author is null then
    return null;
  end if;
  if public.should_suppress_notification(opinion_author, new.author_id) then
    return null;
  end if;
  insert into public.notifications (user_id, actor_id, type, opinion_id, reply_id)
  values (opinion_author, new.author_id, 'reply', new.opinion_id, new.id);
  return null;
end;
$$;

-- 3c. Opinion liked -> notify the opinion author.
create or replace function public.notify_on_opinion_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opinion_author uuid;
begin
  select author_id into opinion_author
  from public.opinions
  where id = new.opinion_id;
  if opinion_author is null then
    return null;
  end if;
  if public.should_suppress_notification(opinion_author, new.user_id) then
    return null;
  end if;
  insert into public.notifications (user_id, actor_id, type, opinion_id)
  values (opinion_author, new.user_id, 'like', new.opinion_id);
  return null;
end;
$$;

-- 3d. Reply liked -> notify the reply author (opinion_id carried along
-- so the read path can apply anonymous masking).
create or replace function public.notify_on_reply_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reply_author uuid;
  parent_opinion uuid;
begin
  select author_id, opinion_id into reply_author, parent_opinion
  from public.replies
  where id = new.reply_id;
  if reply_author is null then
    return null;
  end if;
  if public.should_suppress_notification(reply_author, new.user_id) then
    return null;
  end if;
  insert into public.notifications (user_id, actor_id, type, opinion_id, reply_id)
  values (reply_author, new.user_id, 'like', parent_opinion, new.reply_id);
  return null;
end;
$$;

-- 3e. Repost -> notify the opinion author.
create or replace function public.notify_on_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opinion_author uuid;
begin
  select author_id into opinion_author
  from public.opinions
  where id = new.opinion_id;
  if opinion_author is null then
    return null;
  end if;
  if public.should_suppress_notification(opinion_author, new.user_id) then
    return null;
  end if;
  insert into public.notifications (user_id, actor_id, type, opinion_id)
  values (opinion_author, new.user_id, 'repost', new.opinion_id);
  return null;
end;
$$;

-- 4. Attach the triggers (idempotent: drop first).
drop trigger if exists trg_notify_on_follow on public.follows;
create trigger trg_notify_on_follow
  after insert on public.follows
  for each row execute function public.notify_on_follow();

drop trigger if exists trg_notify_on_reply on public.replies;
create trigger trg_notify_on_reply
  after insert on public.replies
  for each row execute function public.notify_on_reply();

drop trigger if exists trg_notify_on_opinion_like on public.opinion_likes;
create trigger trg_notify_on_opinion_like
  after insert on public.opinion_likes
  for each row execute function public.notify_on_opinion_like();

drop trigger if exists trg_notify_on_reply_like on public.reply_likes;
create trigger trg_notify_on_reply_like
  after insert on public.reply_likes
  for each row execute function public.notify_on_reply_like();

drop trigger if exists trg_notify_on_repost on public.reposts;
create trigger trg_notify_on_repost
  after insert on public.reposts
  for each row execute function public.notify_on_repost();

-- 5. Lock the functions down: only the owner (postgres) and the
-- triggers themselves need them; revoke direct execution from
-- anon/authenticated so the SECURITY DEFINER path is the only one.
revoke all on function public.should_suppress_notification(uuid, uuid) from public, anon, authenticated;
revoke all on function public.notify_on_follow() from public, anon, authenticated;
revoke all on function public.notify_on_reply() from public, anon, authenticated;
revoke all on function public.notify_on_opinion_like() from public, anon, authenticated;
revoke all on function public.notify_on_reply_like() from public, anon, authenticated;
revoke all on function public.notify_on_repost() from public, anon, authenticated;
