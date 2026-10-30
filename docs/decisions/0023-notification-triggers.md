# 0023 — Notification creation via Postgres triggers

Date: 2026-10-30. Status: decided by the user ("Build it"), implemented,
migration written; live apply + verification pending.

## Context

The live QA matrix (user's "check every function") finished 31/33. Both
misses were the notifications section: nothing in the system _created_
notifications. The API could list them and mark them read, but no
follow, reply, like, or repost ever produced one — the Notifications
screen was honestly empty forever. The original design deferred creation
to "a later layer with a server key", and the user ordered it built.

## Decision

Notifications are created by **Postgres triggers**, not by the API and
not with any service key:

- Migration `20261030070000_notification_triggers.sql` adds five
  `AFTER INSERT` triggers: follows → `follow`, replies → `reply`,
  opinion_likes → `like`, reply_likes → `like`, reposts → `repost`.
  Poll votes stay quiet (too noisy at scale).
- The trigger functions are `SECURITY DEFINER` with a fixed
  `search_path = public`, so they bypass RLS on `public.notifications`
  (which has no INSERT policy for anon/authenticated) with **zero key
  material in the repo** — the privacy rule's "no secrets in code"
  holds by construction. Direct execution is revoked from
  anon/authenticated/public; the trigger path is the only one.
- Uniform suppression rules: never notify about your own action, and
  never notify when the recipient blocked the actor
  (`should_suppress_notification()`).
- The notification `type` CHECK is widened to
  `('follow','reply','like','repost','mention','update')`, and the
  `GET /api/notifications?type=` filter accepts the same set.
- Anonymous masking is unchanged and stays at READ time:
  `listNotifications` masks the actor when the linked opinion is
  anonymous, so triggers store `actor_id` raw and stay simple.

## Consequences

- `createNotificationServerOnly()` still throws by design — the API
  must never become a creation path. Its comment now points at the
  triggers instead of "a later layer".
- New migration follows the standing rule: after applying live, run
  one unauthenticated read before calling it verified, plus a live
  end-to-end (follow → notification appears).
- Honest gap closed: the Notifications screen now fills in real use.
  Remaining notification work (push notifications, email digests,
  per-user notification settings) is still future scope.
