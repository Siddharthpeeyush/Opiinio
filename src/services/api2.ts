/**
 * Layer 5 — API services, part 2: follows, polls, and the private
 * tables (bookmarks, mutes, blocks, reports, notifications) plus
 * daily questions. Same order as api.ts: validate -> require
 * session (from the verified caller, never the body) -> can() ->
 * store -> serialise. Private tables are own-only in every
 * function here: list functions filter by the caller's id, single
 * reads use the private-404 rule, and no function accepts a
 * user_id from the caller at all.
 */

import type { AuthUser } from "../lib/auth.js";
import {
  ApiError,
  assertAllowedKeys,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthenticated,
} from "../lib/http.js";
import { validatePollOptions, validateText, validateTopic } from "../lib/validation.js";
import { can } from "./permissions.js";
import {
  bookmarkView,
  blockView,
  dailyQuestionView,
  mutedTopicView,
  mutedWordView,
  notificationView,
  pollView,
  reportView,
} from "./serializers.js";
import { eqFilter, type Row, type Store } from "../db/store.js";
import type { Cursor } from "../lib/pagination.js";
import type { Caller, Page } from "./api.js";

function requireUser(caller: Caller): AuthUser {
  if (caller.user === null) {
    throw unauthenticated();
  }
  return caller.user;
}

function deny(privateResource: boolean): never {
  throw privateResource ? notFound() : forbidden();
}

function str(row: Row, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
}

function nullableStr(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

async function loadRow(store: Store, table: string, id: string): Promise<Row> {
  const row = await store.get(table, id);
  if (row === null) {
    throw notFound();
  }
  return row;
}

// ---------------------------------------------------------------- follows

export async function follow(
  store: Store,
  caller: Caller,
  followingId: string,
): Promise<void> {
  const user = requireUser(caller);
  if (followingId === user.id) {
    throw badRequest("Cannot follow yourself");
  }
  await loadRow(store, "profiles", followingId);
  if (
    !can(user, "create", {
      type: "follows",
      ownerId: user.id,
      followingId,
    })
  ) {
    deny(false);
  }
  const existing = await store.getBy("follows", [
    eqFilter("follower_id", user.id),
    eqFilter("following_id", followingId),
  ]);
  if (existing !== null) {
    throw conflict("Already following");
  }
  await store.insert("follows", { follower_id: user.id, following_id: followingId });
}

export async function unfollow(
  store: Store,
  caller: Caller,
  otherId: string,
): Promise<void> {
  const user = requireUser(caller);
  // Either side may remove the follow (follower unfollows, or the
  // followed user removes a follower). Both directions are checked;
  // a row in neither direction is a 404, not a leak.
  const asFollower = await store.getBy("follows", [
    eqFilter("follower_id", user.id),
    eqFilter("following_id", otherId),
  ]);
  const asFollowing = await store.getBy("follows", [
    eqFilter("follower_id", otherId),
    eqFilter("following_id", user.id),
  ]);
  const row = asFollower ?? asFollowing;
  if (row === null) {
    throw notFound();
  }
  if (
    !can(user, "delete", {
      type: "follows",
      ownerId: str(row, "follower_id"),
      followingId: str(row, "following_id"),
    })
  ) {
    deny(false);
  }
  await store.removeBy("follows", [
    eqFilter("follower_id", str(row, "follower_id")),
    eqFilter("following_id", str(row, "following_id")),
  ]);
}

// ---------------------------------------------------------------- polls

export async function createPoll(
  store: Store,
  caller: Caller,
  opinionId: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof pollView>> {
  const user = requireUser(caller);
  assertAllowedKeys(body, ["options"]);
  const options = validatePollOptions(body.options);
  const opinion = await loadRow(store, "opinions", opinionId);
  const authorId = nullableStr(opinion, "author_id");
  if (authorId !== user.id) {
    deny(false);
  }
  if (!can(user, "create", { type: "polls", opinionAuthorId: authorId })) {
    deny(false);
  }
  const existing = await store.getBy("polls", [eqFilter("opinion_id", opinionId)]);
  if (existing !== null) {
    throw conflict("Opinion already has a poll");
  }
  const poll = await store.insert("polls", { opinion_id: opinionId });
  const optionRows: Row[] = [];
  for (const [index, optionText] of options.entries()) {
    optionRows.push(
      await store.insert("poll_options", {
        poll_id: str(poll, "id"),
        option_text: optionText,
        position: index,
      }),
    );
  }
  return pollView(poll, optionRows, null);
}

export async function getPollByOpinion(
  store: Store,
  caller: Caller,
  opinionId: string,
): Promise<ReturnType<typeof pollView>> {
  if (!can(caller.user, "read", { type: "polls" })) {
    deny(false);
  }
  await loadRow(store, "opinions", opinionId);
  const poll = await store.getBy("polls", [eqFilter("opinion_id", opinionId)]);
  if (poll === null) {
    throw notFound();
  }
  return pollViewFor(store, caller, poll);
}

async function pollViewFor(
  store: Store,
  caller: Caller,
  poll: Row,
): Promise<ReturnType<typeof pollView>> {
  const options = await store.list("poll_options", {
    filters: [eqFilter("poll_id", str(poll, "id"))],
    cursor: null,
    limit: 50,
  });
  let ownOptionId: string | null = null;
  if (caller.user !== null) {
    const vote = await store.getBy("poll_votes", [
      eqFilter("user_id", caller.user.id),
      eqFilter("poll_id", str(poll, "id")),
    ]);
    ownOptionId = vote === null ? null : str(vote, "option_id");
  }
  return pollView(poll, options.rows, ownOptionId);
}

export async function castPollVote(
  store: Store,
  caller: Caller,
  pollId: string,
  optionId: string,
): Promise<ReturnType<typeof pollView>> {
  const user = requireUser(caller);
  const poll = await loadRow(store, "polls", pollId);
  const option = await store.getBy("poll_options", [eqFilter("id", optionId)]);
  if (option === null) {
    throw notFound();
  }
  // API-layer rule (not a DB trigger): the option must belong to
  // this poll. A cross-poll option id is a 400, never a vote.
  if (nullableStr(option, "poll_id") !== pollId) {
    throw badRequest("Poll option does not belong to this poll");
  }
  if (!can(user, "create", { type: "poll_votes", ownerId: user.id })) {
    deny(false);
  }
  const existing = await store.getBy("poll_votes", [
    eqFilter("user_id", user.id),
    eqFilter("poll_id", pollId),
  ]);
  if (existing !== null) {
    // Locked: no UPDATE policy. Undo (DELETE) then re-vote is the
    // only path, and it is deliberate, not a loophole to hide.
    throw conflict("Poll vote already cast");
  }
  await store.insert("poll_votes", {
    user_id: user.id,
    poll_id: pollId,
    option_id: optionId,
  });
  return pollViewFor(store, caller, poll);
}

export async function undoPollVote(
  store: Store,
  caller: Caller,
  pollId: string,
): Promise<void> {
  const user = requireUser(caller);
  await loadRow(store, "polls", pollId);
  const existing = await store.getBy("poll_votes", [
    eqFilter("user_id", user.id),
    eqFilter("poll_id", pollId),
  ]);
  if (existing === null) {
    throw notFound();
  }
  if (!can(user, "delete", { type: "poll_votes", ownerId: user.id })) {
    deny(true);
  }
  await store.removeBy("poll_votes", [
    eqFilter("user_id", user.id),
    eqFilter("poll_id", pollId),
  ]);
}

// ---------------------------------------------------------------- bookmarks

export async function bookmark(
  store: Store,
  caller: Caller,
  opinionId: string,
): Promise<void> {
  const user = requireUser(caller);
  await loadRow(store, "opinions", opinionId);
  if (!can(user, "create", { type: "bookmarks", ownerId: user.id })) {
    deny(true);
  }
  const existing = await store.getBy("bookmarks", [
    eqFilter("user_id", user.id),
    eqFilter("opinion_id", opinionId),
  ]);
  if (existing !== null) {
    throw conflict("Already bookmarked");
  }
  await store.insert("bookmarks", { user_id: user.id, opinion_id: opinionId });
}

export async function unbookmark(
  store: Store,
  caller: Caller,
  opinionId: string,
): Promise<void> {
  const user = requireUser(caller);
  const existing = await store.getBy("bookmarks", [
    eqFilter("user_id", user.id),
    eqFilter("opinion_id", opinionId),
  ]);
  if (existing === null) {
    throw notFound();
  }
  await store.removeBy("bookmarks", [
    eqFilter("user_id", user.id),
    eqFilter("opinion_id", opinionId),
  ]);
}

export async function listBookmarks(
  store: Store,
  caller: Caller,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof bookmarkView>>> {
  const user = requireUser(caller);
  if (!can(user, "read", { type: "bookmarks", ownerId: user.id })) {
    deny(true);
  }
  const result = await store.list("bookmarks", {
    filters: [eqFilter("user_id", user.id)],
    cursor: params.cursor,
    limit: params.limit,
  });
  return {
    items: result.rows.map((row) => bookmarkView(row)),
    nextCursor: result.nextCursor,
  };
}

// ---------------------------------------------------------------- mutes

export async function muteTopic(
  store: Store,
  caller: Caller,
  topic: string,
): Promise<void> {
  const user = requireUser(caller);
  const clean = validateTopic(topic);
  if (!can(user, "create", { type: "muted_topics", ownerId: user.id })) {
    deny(true);
  }
  const existing = await store.getBy("muted_topics", [
    eqFilter("user_id", user.id),
    eqFilter("topic", clean),
  ]);
  if (existing !== null) {
    throw conflict("Topic already muted");
  }
  await store.insert("muted_topics", { user_id: user.id, topic: clean });
}

export async function unmuteTopic(
  store: Store,
  caller: Caller,
  topic: string,
): Promise<void> {
  const user = requireUser(caller);
  const clean = validateTopic(topic);
  const existing = await store.getBy("muted_topics", [
    eqFilter("user_id", user.id),
    eqFilter("topic", clean),
  ]);
  if (existing === null) {
    throw notFound();
  }
  await store.removeBy("muted_topics", [
    eqFilter("user_id", user.id),
    eqFilter("topic", clean),
  ]);
}

export async function listMutedTopics(
  store: Store,
  caller: Caller,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof mutedTopicView>>> {
  const user = requireUser(caller);
  const result = await store.list("muted_topics", {
    filters: [eqFilter("user_id", user.id)],
    cursor: params.cursor,
    limit: params.limit,
  });
  return {
    items: result.rows.map((row) => mutedTopicView(row)),
    nextCursor: result.nextCursor,
  };
}

export async function muteWord(
  store: Store,
  caller: Caller,
  word: string,
): Promise<void> {
  const user = requireUser(caller);
  const clean = validateTopic(word); // Same 1–50 rule as topics (migration 01).
  if (!can(user, "create", { type: "muted_words", ownerId: user.id })) {
    deny(true);
  }
  const existing = await store.getBy("muted_words", [
    eqFilter("user_id", user.id),
    eqFilter("word", clean),
  ]);
  if (existing !== null) {
    throw conflict("Word already muted");
  }
  await store.insert("muted_words", { user_id: user.id, word: clean });
}

export async function unmuteWord(
  store: Store,
  caller: Caller,
  word: string,
): Promise<void> {
  const user = requireUser(caller);
  const clean = validateTopic(word);
  const existing = await store.getBy("muted_words", [
    eqFilter("user_id", user.id),
    eqFilter("word", clean),
  ]);
  if (existing === null) {
    throw notFound();
  }
  await store.removeBy("muted_words", [
    eqFilter("user_id", user.id),
    eqFilter("word", clean),
  ]);
}

export async function listMutedWords(
  store: Store,
  caller: Caller,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof mutedWordView>>> {
  const user = requireUser(caller);
  const result = await store.list("muted_words", {
    filters: [eqFilter("user_id", user.id)],
    cursor: params.cursor,
    limit: params.limit,
  });
  return {
    items: result.rows.map((row) => mutedWordView(row)),
    nextCursor: result.nextCursor,
  };
}

// ---------------------------------------------------------------- blocks

export async function block(
  store: Store,
  caller: Caller,
  blockedId: string,
): Promise<void> {
  const user = requireUser(caller);
  if (blockedId === user.id) {
    throw badRequest("Cannot block yourself");
  }
  await loadRow(store, "profiles", blockedId);
  if (!can(user, "create", { type: "blocks", ownerId: user.id, blockedId })) {
    deny(true);
  }
  const existing = await store.getBy("blocks", [
    eqFilter("blocker_id", user.id),
    eqFilter("blocked_id", blockedId),
  ]);
  if (existing !== null) {
    throw conflict("Already blocked");
  }
  // The migration-02 trigger removes follows both ways on INSERT;
  // this service does not delete follows itself, so the trigger
  // stays the single place that rule lives.
  await store.insert("blocks", { blocker_id: user.id, blocked_id: blockedId });
}

export async function unblock(
  store: Store,
  caller: Caller,
  blockedId: string,
): Promise<void> {
  const user = requireUser(caller);
  const existing = await store.getBy("blocks", [
    eqFilter("blocker_id", user.id),
    eqFilter("blocked_id", blockedId),
  ]);
  if (existing === null) {
    throw notFound();
  }
  await store.removeBy("blocks", [
    eqFilter("blocker_id", user.id),
    eqFilter("blocked_id", blockedId),
  ]);
}

export async function listBlocks(
  store: Store,
  caller: Caller,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof blockView>>> {
  const user = requireUser(caller);
  const result = await store.list("blocks", {
    filters: [eqFilter("blocker_id", user.id)],
    cursor: params.cursor,
    limit: params.limit,
  });
  return {
    items: result.rows.map((row) => blockView(row)),
    nextCursor: result.nextCursor,
  };
}

// ---------------------------------------------------------------- reports

export async function createReport(
  store: Store,
  caller: Caller,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof reportView>> {
  const user = requireUser(caller);
  assertAllowedKeys(body, ["opinion_id", "reply_id", "reason"]);
  const reason = validateText(body.reason, "reason");
  const opinionId = body.opinion_id === undefined ? null : body.opinion_id;
  const replyId = body.reply_id === undefined ? null : body.reply_id;
  // Exactly one target (migration 01 CHECK). Two targets or none
  // is a 400, and a missing target row is a 404.
  if ((opinionId === null) === (replyId === null)) {
    throw badRequest("Report exactly one opinion or reply");
  }
  if (opinionId !== null) {
    if (typeof opinionId !== "string") {
      throw badRequest("opinion_id must be a string");
    }
    await loadRow(store, "opinions", opinionId);
  }
  if (replyId !== null) {
    if (typeof replyId !== "string") {
      throw badRequest("reply_id must be a string");
    }
    await loadRow(store, "replies", replyId);
  }
  if (!can(user, "create", { type: "reports", ownerId: user.id })) {
    deny(true);
  }
  const report = await store.insert("reports", {
    reporter_id: user.id,
    opinion_id: opinionId,
    reply_id: replyId,
    reason,
  });
  return reportView(report);
}

export async function listReports(
  store: Store,
  caller: Caller,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof reportView>>> {
  const user = requireUser(caller);
  const result = await store.list("reports", {
    filters: [eqFilter("reporter_id", user.id)],
    cursor: params.cursor,
    limit: params.limit,
  });
  return {
    items: result.rows.map((row) => reportView(row)),
    nextCursor: result.nextCursor,
  };
}

export async function getReport(
  store: Store,
  caller: Caller,
  id: string,
): Promise<ReturnType<typeof reportView>> {
  const user = requireUser(caller);
  const row = await store.get("reports", id);
  // Private row: missing and wrong-owner are both 404.
  if (row === null || str(row, "reporter_id") !== user.id) {
    throw notFound();
  }
  if (!can(user, "read", { type: "reports", ownerId: user.id })) {
    throw notFound();
  }
  return reportView(row);
}

// ---------------------------------------------------------------- notifications

export async function listNotifications(
  store: Store,
  caller: Caller,
  params: { type?: string; limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof notificationView>>> {
  const user = requireUser(caller);
  if (!can(user, "read", { type: "notifications", ownerId: user.id })) {
    deny(true);
  }
  const filters: string[] = [eqFilter("user_id", user.id)];
  if (params.type !== undefined) {
    if (!["mention", "reply", "update"].includes(params.type)) {
      throw badRequest("type must be mention, reply, or update");
    }
    filters.push(eqFilter("type", params.type));
  }
  const result = await store.list("notifications", {
    filters,
    cursor: params.cursor,
    limit: params.limit,
  });
  const items: ReturnType<typeof notificationView>[] = [];
  for (const row of result.rows) {
    // Actor masking: if the linked opinion is anonymous, the actor
    // is masked too — otherwise a notification would unmask an
    // anonymous post through the actor field.
    let actorAnonymous = false;
    let actorRow: Row | null = null;
    const actorId = nullableStr(row, "actor_id");
    if (actorId !== null) {
      actorRow = await loadRow(store, "profiles", actorId).catch(() => null);
      const opinionId = nullableStr(row, "opinion_id");
      if (opinionId !== null) {
        const opinion = await store.get("opinions", opinionId);
        actorAnonymous = opinion !== null && opinion.is_anonymous === true;
      }
    }
    items.push(notificationView(row, actorRow, actorAnonymous));
  }
  return { items, nextCursor: result.nextCursor };
}

export async function markNotificationRead(
  store: Store,
  caller: Caller,
  id: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof notificationView>> {
  const user = requireUser(caller);
  assertAllowedKeys(body, ["is_read"]);
  if (body.is_read !== true) {
    // Mark-read only: no other field, and no un-reading via this
    // endpoint. Anything else is a 400, not a silent no-op.
    throw badRequest("is_read must be true");
  }
  const row = await store.get("notifications", id);
  if (row === null || str(row, "user_id") !== user.id) {
    throw notFound();
  }
  if (!can(user, "update", { type: "notifications", ownerId: user.id })) {
    throw notFound();
  }
  const updated = await store.update("notifications", id, { is_read: true });
  if (updated === null) {
    throw notFound();
  }
  return notificationView(updated, null, false);
}

/**
 * SERVER-ONLY STUB — deliberately not routed, not implemented.
 * Notifications are created by the server in a later layer with a
 * server key that must never be stored in this repo. Calling this
 * function in Layer 5 is a bug: it throws, so no code path can
 * mistake the stub for a working creation path.
 */
export function createNotificationServerOnly(): never {
  throw new ApiError(403, "SERVER_ONLY", "Notifications are created by the server only");
}

// ---------------------------------------------------------------- daily questions

export async function listDailyQuestions(
  store: Store,
  caller: Caller,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof dailyQuestionView>>> {
  if (!can(caller.user, "read", { type: "daily_questions" })) {
    deny(false);
  }
  const result = await store.list("daily_questions", {
    filters: [],
    cursor: params.cursor,
    limit: params.limit,
  });
  return {
    items: result.rows.map((row) => dailyQuestionView(row)),
    nextCursor: result.nextCursor,
  };
}

export async function getDailyQuestion(
  store: Store,
  caller: Caller,
  id: string,
): Promise<ReturnType<typeof dailyQuestionView>> {
  if (!can(caller.user, "read", { type: "daily_questions" })) {
    deny(false);
  }
  const row = await loadRow(store, "daily_questions", id);
  return dailyQuestionView(row);
}
