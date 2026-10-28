/**
 * Central permission check — the ONLY place that answers
 * "may this user do this to this row?".
 *
 * Every Layer 5 endpoint must call can() before it touches a row,
 * and must never re-implement a rule inline. This mirrors the RLS
 * policies in supabase/migrations/20261029040000_rls.sql, so the
 * app layer and the database layer agree; where they disagree,
 * RLS is the backstop and the discrepancy is a bug to report, not
 * to work around. See docs/permissions.md for the full matrix.
 *
 * Conventions:
 * - user = null means a visitor (logged out). Visitors may read
 *   public rows only, and may write nothing.
 * - ownerId is the user id that owns the row (author_id, user_id,
 *   follower_id, blocker_id, reporter_id, or profile id, per table).
 * - opinionAuthorId is used only for polls/poll_options, which are
 *   created by the opinion's author, not by the poll row's owner.
 * - "private" in the matrix means: a signed-in user who is not the
 *   owner must get 404 for a READ (see deniedStatus in lib/auth.ts),
 *   so the row's existence is not confirmed.
 */

import type { AuthUser } from "../lib/auth.js";

export type TableName =
  | "profiles"
  | "daily_questions"
  | "opinions"
  | "replies"
  | "opinion_votes"
  | "opinion_likes"
  | "reply_likes"
  | "reposts"
  | "follows"
  | "polls"
  | "poll_options"
  | "poll_votes"
  | "bookmarks"
  | "muted_topics"
  | "muted_words"
  | "blocks"
  | "reports"
  | "notifications";

export type Action = "read" | "create" | "update" | "delete";

export interface Resource {
  type: TableName;
  /** Owner user id of the row, when the row has one. */
  ownerId?: string | null | undefined;
  /**
   * For polls/poll_options: the author of the opinion the poll
   * belongs to. Required for create/delete on those tables.
   */
  opinionAuthorId?: string | null | undefined;
  /**
   * For follows: the user being followed. Required for create
   * (no self-follow) and used for delete (follower or following
   * may remove the follow).
   */
  followingId?: string | null | undefined;
  /**
   * For blocks: the user being blocked. Required for create
   * (no self-block).
   */
  blockedId?: string | null | undefined;
}

/** Tables whose rows are readable by visitors (anon + authenticated). */
const PUBLIC_READ: ReadonlySet<TableName> = new Set([
  "profiles",
  "daily_questions",
  "opinions",
  "replies",
  "opinion_likes",
  "reply_likes",
  "reposts",
  "follows",
  "polls",
  "poll_options",
]);

/** Tables whose rows are private to one user (read: owner only). */
const PRIVATE_READ: ReadonlySet<TableName> = new Set([
  "opinion_votes",
  "poll_votes",
  "bookmarks",
  "muted_topics",
  "muted_words",
  "blocks",
  "reports",
  "notifications",
]);

function isOwner(user: AuthUser | null, ownerId: string | null | undefined): boolean {
  return (
    user !== null && ownerId !== null && ownerId !== undefined && user.id === ownerId
  );
}

function canRead(user: AuthUser | null, resource: Resource): boolean {
  if (PUBLIC_READ.has(resource.type)) {
    return true;
  }
  if (PRIVATE_READ.has(resource.type)) {
    return isOwner(user, resource.ownerId);
  }
  return false;
}

function canCreate(user: AuthUser | null, resource: Resource): boolean {
  if (user === null) {
    return false;
  }
  switch (resource.type) {
    case "daily_questions":
    case "notifications":
      // Server-only rows (service role in a later layer). A regular
      // user has no INSERT policy for these in migration 04.
      return false;
    case "profiles":
    case "opinions":
    case "replies":
    case "opinion_votes":
    case "opinion_likes":
    case "reply_likes":
    case "reposts":
    case "poll_votes":
    case "bookmarks":
    case "muted_topics":
    case "muted_words":
    case "reports":
      return isOwner(user, resource.ownerId);
    case "follows":
      // No self-follow, enforced in the DB and here.
      return (
        isOwner(user, resource.ownerId) &&
        resource.followingId !== null &&
        resource.followingId !== undefined &&
        resource.followingId !== user.id
      );
    case "blocks":
      // No self-block, enforced in the DB and here.
      return (
        isOwner(user, resource.ownerId) &&
        resource.blockedId !== null &&
        resource.blockedId !== undefined &&
        resource.blockedId !== user.id
      );
    case "polls":
    case "poll_options":
      // Created only by the author of the opinion the poll belongs to.
      return (
        resource.opinionAuthorId !== null &&
        resource.opinionAuthorId !== undefined &&
        user.id === resource.opinionAuthorId
      );
    default:
      return false;
  }
}

function canUpdate(user: AuthUser | null, resource: Resource): boolean {
  if (user === null) {
    return false;
  }
  switch (resource.type) {
    case "profiles":
    case "opinions":
    case "replies":
    case "opinion_votes":
      // Stance votes allow UPDATE: a user may change
      // Agree/Neutral/Disagree. Poll votes do not (locked).
      return isOwner(user, resource.ownerId);
    case "notifications":
      // Mark-read only: owner may update is_read. Layer 5 must
      // reject updates to any other field on this row.
      return isOwner(user, resource.ownerId);
    case "muted_topics":
    case "muted_words":
    case "blocks":
      return isOwner(user, resource.ownerId);
    default:
      // No UPDATE policy in migration 04 for: daily_questions,
      // opinion_likes, reply_likes, reposts, follows, polls,
      // poll_options, poll_votes, bookmarks, reports.
      return false;
  }
}

function canDelete(user: AuthUser | null, resource: Resource): boolean {
  if (user === null) {
    return false;
  }
  switch (resource.type) {
    case "follows":
      // Follower may unfollow; the followed user may remove the
      // follower (this is also how block-removes-follow is undone).
      return (
        isOwner(user, resource.ownerId) ||
        (resource.followingId !== null &&
          resource.followingId !== undefined &&
          user.id === resource.followingId)
      );
    case "polls":
      return (
        resource.opinionAuthorId !== null &&
        resource.opinionAuthorId !== undefined &&
        user.id === resource.opinionAuthorId
      );
    case "profiles":
    case "opinions":
    case "replies":
    case "opinion_votes":
    case "opinion_likes":
    case "reply_likes":
    case "reposts":
    case "poll_votes":
    case "bookmarks":
    case "muted_topics":
    case "muted_words":
    case "blocks":
    case "reports":
      return isOwner(user, resource.ownerId);
    default:
      // No DELETE policy in migration 04 for: daily_questions,
      // poll_options, notifications.
      return false;
  }
}

/**
 * The central check. Returns true only when the action is allowed.
 * It never throws for a null user or a missing owner id — those are
 * ordinary denials (false), and the caller maps them with
 * deniedStatus() in lib/auth.ts.
 */
export function can(user: AuthUser | null, action: Action, resource: Resource): boolean {
  switch (action) {
    case "read":
      return canRead(user, resource);
    case "create":
      return canCreate(user, resource);
    case "update":
      return canUpdate(user, resource);
    case "delete":
      return canDelete(user, resource);
    default:
      return false;
  }
}

/** True when a read denial for this table must be reported as 404. */
export function isPrivateTable(type: TableName): boolean {
  return PRIVATE_READ.has(type);
}
