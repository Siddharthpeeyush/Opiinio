/**
 * Layer 5 — serializers: the ONLY shapes that leave the server.
 *
 * Rules, applied in every serializer without exception:
 * - Anonymous: author_id null, handle/display "Anonymous",
 *   initials "AN" (via src/services/anonymous.ts, never re-derived
 *   here). This applies to feed, detail, search, quote blocks,
 *   notifications, replies, and Daily answers — and to the author's
 *   own list views too, so no code path can be used as an oracle
 *   for "is this anonymous post mine/theirs?".
 * - Vote privacy: aggregates (counts) only. A voter list is never
 *   built, and another user's vote/like is never included. The
 *   caller sees only their OWN stance/like/option, passed in
 *   explicitly by the service that already proved ownership.
 * - No personal data: email, auth metadata, phone, IP, tokens,
 *   and MFA material are not fields on any row this layer selects
 *   (see COLUMNS in src/db/store.ts) and are never added here.
 * - Data minimisation: each serializer picks named fields. A full
 *   DB row is never spread into a response.
 */

import { initialsFor, maskAuthor, type PublicAuthor } from "./anonymous.js";
import type { Row } from "../db/store.js";

function str(row: Row, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
}

function nullableStr(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function num(row: Row, key: string): number {
  return typeof row[key] === "number" ? row[key] : 0;
}

function bool(row: Row, key: string): boolean {
  return row[key] === true;
}

export interface PublicProfileView {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  followerCount: number;
  followingCount: number;
  pinnedOpinionId: string | null;
  initials: string;
  createdAt: string;
}

export function publicProfile(row: Row): PublicProfileView {
  const displayName = str(row, "display_name");
  return {
    id: str(row, "id"),
    handle: str(row, "handle"),
    displayName,
    bio: nullableStr(row, "bio"),
    followerCount: num(row, "follower_count"),
    followingCount: num(row, "following_count"),
    pinnedOpinionId: nullableStr(row, "pinned_opinion_id"),
    initials: initialsFor(displayName),
    createdAt: str(row, "created_at"),
  };
}

export interface OpinionView {
  id: string;
  body: string;
  topic: string;
  isAnonymous: boolean;
  dailyQuestionId: string | null;
  author: PublicAuthor;
  agreeCount: number;
  neutralCount: number;
  disagreeCount: number;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  /** The caller's OWN stance, or null when they have not voted. Never another's. */
  ownStance: string | null;
  /** Whether the caller liked this opinion. Never another's like. */
  ownLiked: boolean;
  createdAt: string;
}

export function opinionView(
  row: Row,
  authorRow: Row | null,
  own: { stance: string | null; liked: boolean },
): OpinionView {
  const anonymous = bool(row, "is_anonymous");
  const author = maskAuthor(
    {
      authorId: nullableStr(row, "author_id"),
      handle: authorRow === null ? "" : str(authorRow, "handle"),
      displayName: authorRow === null ? "" : str(authorRow, "display_name"),
      initials: authorRow === null ? "OP" : initialsFor(str(authorRow, "display_name")),
    },
    anonymous,
  );
  return {
    id: str(row, "id"),
    body: str(row, "body"),
    topic: str(row, "topic"),
    isAnonymous: anonymous,
    dailyQuestionId: nullableStr(row, "daily_question_id"),
    author,
    agreeCount: num(row, "agree_count"),
    neutralCount: num(row, "neutral_count"),
    disagreeCount: num(row, "disagree_count"),
    likeCount: num(row, "like_count"),
    repostCount: num(row, "repost_count"),
    replyCount: num(row, "reply_count"),
    ownStance: own.stance,
    ownLiked: own.liked,
    createdAt: str(row, "created_at"),
  };
}

export interface ReplyView {
  id: string;
  opinionId: string;
  body: string;
  side: string;
  voiceScore: number;
  author: PublicAuthor;
  ownLiked: boolean;
  createdAt: string;
}

export function replyView(row: Row, authorRow: Row | null, ownLiked: boolean): ReplyView {
  // Replies have no is_anonymous column in migration 01: a reply is
  // always attributed. (Anonymous mode is a per-opinion toggle.)
  const author = maskAuthor(
    {
      authorId: nullableStr(row, "author_id"),
      handle: authorRow === null ? "" : str(authorRow, "handle"),
      displayName: authorRow === null ? "" : str(authorRow, "display_name"),
      initials: authorRow === null ? "OP" : initialsFor(str(authorRow, "display_name")),
    },
    false,
  );
  return {
    id: str(row, "id"),
    opinionId: str(row, "opinion_id"),
    body: str(row, "body"),
    side: str(row, "side"),
    voiceScore: num(row, "voice_score"),
    author,
    ownLiked,
    createdAt: str(row, "created_at"),
  };
}

export interface PollOptionView {
  id: string;
  optionText: string;
  position: number;
  voteCount: number;
}

export interface PollView {
  id: string;
  opinionId: string;
  options: PollOptionView[];
  /** The caller's OWN voted option, or null. Never another's vote. */
  ownOptionId: string | null;
}

export function pollView(
  pollRow: Row,
  optionRows: Row[],
  ownOptionId: string | null,
): PollView {
  const options = [...optionRows]
    .sort((a, b) => num(a, "position") - num(b, "position"))
    .map((option) => ({
      id: str(option, "id"),
      optionText: str(option, "option_text"),
      position: num(option, "position"),
      voteCount: num(option, "vote_count"),
    }));
  return {
    id: str(pollRow, "id"),
    opinionId: str(pollRow, "opinion_id"),
    options,
    ownOptionId,
  };
}

export interface RepostView {
  id: string;
  opinionId: string;
  quoteTake: string | null;
  repostedBy: PublicProfileView | null;
  /** The original opinion, masked if it is anonymous. */
  original: OpinionView | null;
  createdAt: string;
}

export function repostView(
  row: Row,
  reposterRow: Row | null,
  original: OpinionView | null,
): RepostView {
  return {
    id: str(row, "id"),
    opinionId: str(row, "opinion_id"),
    quoteTake: nullableStr(row, "quote_take"),
    repostedBy: reposterRow === null ? null : publicProfile(reposterRow),
    original,
    createdAt: str(row, "created_at"),
  };
}

/** Own-only private views: the caller is always the owner here. */
export function bookmarkView(row: Row): { opinionId: string; createdAt: string } {
  return { opinionId: str(row, "opinion_id"), createdAt: str(row, "created_at") };
}

export function mutedTopicView(row: Row): { topic: string; createdAt: string } {
  return { topic: str(row, "topic"), createdAt: str(row, "created_at") };
}

export function mutedWordView(row: Row): { word: string; createdAt: string } {
  return { word: str(row, "word"), createdAt: str(row, "created_at") };
}

export function blockView(row: Row): { blockedId: string; createdAt: string } {
  return { blockedId: str(row, "blocked_id"), createdAt: str(row, "created_at") };
}

export function reportView(row: Row): {
  id: string;
  opinionId: string | null;
  replyId: string | null;
  reason: string;
  createdAt: string;
} {
  return {
    id: str(row, "id"),
    opinionId: nullableStr(row, "opinion_id"),
    replyId: nullableStr(row, "reply_id"),
    reason: str(row, "reason"),
    createdAt: str(row, "created_at"),
  };
}

export interface NotificationView {
  id: string;
  type: string;
  opinionId: string | null;
  replyId: string | null;
  isRead: boolean;
  /** Actor masked to "Anonymous" when the source content is anonymous. */
  actor: PublicAuthor | null;
  createdAt: string;
}

export function notificationView(
  row: Row,
  actorRow: Row | null,
  actorAnonymous: boolean,
): NotificationView {
  const actor =
    actorRow === null
      ? null
      : maskAuthor(
          {
            authorId: nullableStr(row, "actor_id"),
            handle: str(actorRow, "handle"),
            displayName: str(actorRow, "display_name"),
            initials: initialsFor(str(actorRow, "display_name")),
          },
          actorAnonymous,
        );
  return {
    id: str(row, "id"),
    type: str(row, "type"),
    opinionId: nullableStr(row, "opinion_id"),
    replyId: nullableStr(row, "reply_id"),
    isRead: bool(row, "is_read"),
    actor,
    createdAt: str(row, "created_at"),
  };
}

export function dailyQuestionView(row: Row): {
  id: string;
  question: string;
  questionDate: string;
  createdAt: string;
} {
  return {
    id: str(row, "id"),
    question: str(row, "question"),
    questionDate: str(row, "question_date"),
    createdAt: str(row, "created_at"),
  };
}
