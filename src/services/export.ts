/**
 * Layer 10 — account data export (privacy right).
 *
 * GET /api/account/export returns the CALLER's own data only:
 * profile, opinions, replies, votes, likes, reposts, follows,
 * polls (with their options), bookmarks, muted topics/words,
 * blocks, reports, and notifications. Every table is filtered by
 * the caller's own id; no other user's rows are read or
 * returned. Rows are returned as raw database rows (snake_case)
 * for portability — masking is a presentation concern and this
 * is the caller's own data, including their own anonymous
 * posts (with is_anonymous preserved).
 *
 * Deliberately excluded: daily_questions (not user data),
 * server-only tables, and other users' rows.
 *
 * Account deletion is NOT built here: GoTrue user deletion needs
 * the admin API + service_role key, which is never wired into
 * this repo. The route stays aal-gated and SERVER_ONLY in
 * src/routes/auth.ts; see docs/decisions/0015-security-review.md.
 */

import type { AuthUser } from "../lib/auth.js";
import { unauthenticated } from "../lib/http.js";
import { eqFilter, type Row, type Store } from "../db/store.js";
import { can } from "./permissions.js";
import type { Caller } from "./api.js";

/** Rows per table before the export marks it truncated. */
const EXPORT_LIMIT = 500;

export interface AccountExport {
  exportedAt: string;
  userId: string;
  profile: Row | null;
  opinions: Row[];
  replies: Row[];
  opinionVotes: Row[];
  opinionLikes: Row[];
  replyLikes: Row[];
  reposts: Row[];
  /** Follows the caller created (who they follow). */
  following: Row[];
  /** Follows that point at the caller (their followers). */
  followers: Row[];
  /** The caller's polls, each with its options embedded. */
  polls: Array<Row & { options: Row[] }>;
  pollVotes: Row[];
  bookmarks: Row[];
  mutedTopics: Row[];
  mutedWords: Row[];
  blocks: Row[];
  reports: Row[];
  notifications: Row[];
  /** Table names that hit EXPORT_LIMIT and were cut. */
  truncated: string[];
}

function requireUser(caller: Caller): AuthUser {
  if (caller.user === null) {
    throw unauthenticated();
  }
  return caller.user;
}

async function listOwn(
  store: Store,
  table: string,
  column: string,
  userId: string,
  truncated: string[],
): Promise<Row[]> {
  const result = await store.list(table, {
    filters: [eqFilter(column, userId)],
    cursor: null,
    limit: EXPORT_LIMIT,
  });
  if (result.rows.length >= EXPORT_LIMIT && !truncated.includes(table)) {
    truncated.push(table);
  }
  return result.rows;
}

export async function exportAccount(
  store: Store,
  caller: Caller,
): Promise<AccountExport> {
  const user = requireUser(caller);
  // One central gate for the whole export: the caller may always
  // read their own data. Mirrors the private-table rules — a
  // denied caller gets 401 above or 403/404 from can(), never
  // anyone else's rows.
  if (!can(user, "read", { type: "profiles", ownerId: user.id })) {
    throw unauthenticated();
  }
  const me = user.id;
  const truncated: string[] = [];

  const profile = await store.get("profiles", me);
  const opinions = await listOwn(store, "opinions", "author_id", me, truncated);
  const replies = await listOwn(store, "replies", "author_id", me, truncated);
  const opinionVotes = await listOwn(store, "opinion_votes", "user_id", me, truncated);
  const opinionLikes = await listOwn(store, "opinion_likes", "user_id", me, truncated);
  const replyLikes = await listOwn(store, "reply_likes", "user_id", me, truncated);
  const reposts = await listOwn(store, "reposts", "user_id", me, truncated);
  const following = await listOwn(store, "follows", "follower_id", me, truncated);
  const followers = await listOwn(store, "follows", "following_id", me, truncated);
  const pollVotes = await listOwn(store, "poll_votes", "user_id", me, truncated);
  const bookmarks = await listOwn(store, "bookmarks", "user_id", me, truncated);
  const mutedTopics = await listOwn(store, "muted_topics", "user_id", me, truncated);
  const mutedWords = await listOwn(store, "muted_words", "user_id", me, truncated);
  // blocks uses blocker_id, reports uses reporter_id (see COLUMNS).
  const blocks = await listOwn(store, "blocks", "blocker_id", me, truncated);
  const reports = await listOwn(store, "reports", "reporter_id", me, truncated);
  const notifications = await listOwn(store, "notifications", "user_id", me, truncated);

  // Polls are owned through the opinion's author (no user_id on
  // the poll row itself): load polls per own opinion, then embed
  // each poll's options.
  const polls: Array<Row & { options: Row[] }> = [];
  for (const opinion of opinions) {
    const opinionId = opinion["id"];
    if (typeof opinionId !== "string") {
      continue;
    }
    const rows = await listOwn(store, "polls", "opinion_id", opinionId, truncated);
    for (const poll of rows) {
      const pollId = poll["id"];
      const options =
        typeof pollId === "string"
          ? await listOwn(store, "poll_options", "poll_id", pollId, truncated)
          : [];
      polls.push({ ...poll, options });
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    userId: me,
    profile,
    opinions,
    replies,
    opinionVotes,
    opinionLikes,
    replyLikes,
    reposts,
    following,
    followers,
    polls,
    pollVotes,
    bookmarks,
    mutedTopics,
    mutedWords,
    blocks,
    reports,
    notifications,
    truncated,
  };
}
