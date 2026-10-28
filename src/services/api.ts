/**
 * Layer 5 — API services: the business logic for every resource.
 *
 * Every function here follows the same order, and the order is the
 * privacy guarantee:
 *   1. Validate input (boundary, generic messages).
 *   2. Require a verified session for every write (caller.user
 *      comes from Layer 4 verifySession(); NEVER from the body,
 *      query, or a header the caller invented — routes pass only
 *      the verified user in, and services never read author_id /
 *      user_id / email out of a request body).
 *   3. can() before any read/write (src/services/permissions.ts).
 *      Denials: no user -> 401; forbidden on a public row -> 403;
 *      forbidden on a private row -> 404 (existence not leaked).
 *   4. Store call through the Store interface (explicit columns).
 *   5. Serialise through src/services/serializers.ts — anonymous
 *      masking and vote privacy happen there, on every path.
 *
 * What this module deliberately does NOT do:
 * - It never builds a voter list, never returns another user's
 *   vote/like, never returns email/phone/token/MFA material.
 * - It never creates a notification or daily question for a user:
 *   those are server-only; createNotificationServerOnly() throws
 *   and is not routed (a later layer wires it with a server key
 *   that must never live in this repo's client code).
 * - It never lists profiles or checks "does this handle/email
 *   exist": no enumeration oracle. Handle collisions are handled
 *   by the migration-05 fallback, not by a lookup endpoint.
 */

import type { AuthUser } from "../lib/auth.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthenticated,
  ApiError,
  assertAllowedKeys,
} from "../lib/http.js";
import {
  validateDisplayName,
  validateOptionalText,
  validatePollOptions,
  validateSearch,
  validateSide,
  validateStance,
  validateText,
  validateTopic,
  type Side,
  type Stance,
} from "../lib/validation.js";
import { can, type TableName } from "./permissions.js";
import {
  opinionView,
  publicProfile,
  repostView,
  replyView,
  type OpinionView,
} from "./serializers.js";
import { eqFilter, ilikeFilter, StoreError, type Row, type Store } from "../db/store.js";
import type { Cursor } from "../lib/pagination.js";

export interface Caller {
  user: AuthUser | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function requireUser(caller: Caller): AuthUser {
  if (caller.user === null) {
    throw unauthenticated();
  }
  return caller.user;
}

/** Denial for a signed-in user: 404 for private rows, else 403. */
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

function bool(row: Row, key: string): boolean {
  return row[key] === true;
}

async function loadRow(store: Store, table: string, id: string): Promise<Row> {
  const row = await store.get(table, id);
  if (row === null) {
    throw notFound();
  }
  return row;
}

async function loadAuthor(store: Store, authorId: string | null): Promise<Row | null> {
  if (authorId === null || authorId === "") {
    return null;
  }
  return store.get("profiles", authorId);
}

async function ownVoteAndLike(
  store: Store,
  caller: AuthUser | null,
  opinionId: string,
): Promise<{ stance: string | null; liked: boolean }> {
  if (caller === null) {
    return { stance: null, liked: false };
  }
  const vote = await store.getBy("opinion_votes", [
    eqFilter("user_id", caller.id),
    eqFilter("opinion_id", opinionId),
  ]);
  const like = await store.getBy("opinion_likes", [
    eqFilter("user_id", caller.id),
    eqFilter("opinion_id", opinionId),
  ]);
  return {
    stance: vote === null ? null : str(vote, "stance"),
    liked: like !== null,
  };
}

async function toOpinionView(
  store: Store,
  caller: AuthUser | null,
  row: Row,
): Promise<OpinionView> {
  // Anonymous author rows are never even loaded for the response
  // path: the serializer masks, and this keeps the real profile
  // out of the response-building code entirely.
  const anonymous = bool(row, "is_anonymous");
  const authorRow = anonymous
    ? null
    : await loadAuthor(store, nullableStr(row, "author_id"));
  const own = await ownVoteAndLike(store, caller, str(row, "id"));
  return opinionView(row, authorRow, own);
}

async function toRepostView(
  store: Store,
  caller: AuthUser | null,
  row: Row,
): Promise<ReturnType<typeof repostView>> {
  const reposterRow = await loadAuthor(store, nullableStr(row, "user_id"));
  const originalRow = await store.get("opinions", str(row, "opinion_id"));
  const original =
    originalRow === null ? null : await toOpinionView(store, caller, originalRow);
  return repostView(row, reposterRow, original);
}

function mapStoreError(error: unknown): never {
  if (error instanceof StoreError) {
    if (error.status === 409) {
      throw conflict("Already exists");
    }
    if (error.status === 503) {
      throw new ApiError(503, "SERVICE_UNAVAILABLE", "Service unavailable");
    }
  }
  throw error;
}

// ---------------------------------------------------------------- profiles

export async function getProfile(
  store: Store,
  caller: Caller,
  id: string,
): Promise<ReturnType<typeof publicProfile>> {
  // Public read: visitors allowed, can() agrees (profiles public).
  if (!can(caller.user, "read", { type: "profiles" })) {
    deny(false);
  }
  const row = await loadRow(store, "profiles", id);
  return publicProfile(row);
}

export async function updateProfile(
  store: Store,
  caller: Caller,
  id: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof publicProfile>> {
  const user = requireUser(caller);
  assertAllowedKeys(body, ["display_name", "bio", "pinned_opinion_id"]);
  if (user.id !== id) {
    deny(false); // Profile existence is public, so 403 is correct here.
  }
  if (!can(user, "update", { type: "profiles", ownerId: id })) {
    deny(false);
  }
  const patch: Row = {};
  if (body.display_name !== undefined) {
    patch.display_name = validateDisplayName(body.display_name);
  }
  if (body.bio !== undefined) {
    patch.bio = validateOptionalText(body.bio, "bio");
  }
  if (body.pinned_opinion_id !== undefined) {
    const pinned = body.pinned_opinion_id;
    if (pinned !== null) {
      if (typeof pinned !== "string") {
        throw badRequest("pinned_opinion_id must be a string or null");
      }
      const opinion = await loadRow(store, "opinions", pinned);
      if (nullableStr(opinion, "author_id") !== user.id) {
        deny(false);
      }
    }
    patch.pinned_opinion_id = pinned;
  }
  if (Object.keys(patch).length === 0) {
    throw badRequest("Nothing to update");
  }
  const updated = await store.update("profiles", id, patch);
  if (updated === null) {
    throw notFound();
  }
  return publicProfile(updated);
}

// ---------------------------------------------------------------- opinions

export interface OpinionInput {
  body: unknown;
  topic: unknown;
  is_anonymous?: unknown;
  daily_question_id?: unknown;
  poll_options?: unknown;
}

export async function createOpinion(
  store: Store,
  caller: Caller,
  input: OpinionInput,
): Promise<OpinionView> {
  const user = requireUser(caller);
  // Identity comes ONLY from the verified session, never the body.
  // Unknown keys (e.g. a forged author_id) are rejected, not ignored.
  assertAllowedKeys(input as unknown as Record<string, unknown>, [
    "body",
    "topic",
    "is_anonymous",
    "daily_question_id",
    "poll_options",
  ]);
  const body = validateText(input.body, "body");
  const topic = validateTopic(input.topic);
  const isAnonymous = input.is_anonymous === true;
  let dailyQuestionId: string | null = null;
  if (input.daily_question_id !== undefined && input.daily_question_id !== null) {
    if (typeof input.daily_question_id !== "string") {
      throw badRequest("daily_question_id must be a string or null");
    }
    await loadRow(store, "daily_questions", input.daily_question_id);
    dailyQuestionId = input.daily_question_id;
  }
  let pollOptions: string[] | null = null;
  if (input.poll_options !== undefined && input.poll_options !== null) {
    pollOptions = validatePollOptions(input.poll_options);
  }
  if (!can(user, "create", { type: "opinions", ownerId: user.id })) {
    deny(false);
  }
  let opinion: Row;
  try {
    opinion = await store.insert("opinions", {
      author_id: user.id,
      body,
      topic,
      is_anonymous: isAnonymous,
      daily_question_id: dailyQuestionId,
    });
  } catch (error) {
    mapStoreError(error);
  }
  if (pollOptions !== null) {
    // Poll creation is opinion-author-only; the author is the caller
    // by construction here, so can() for polls is satisfied.
    if (!can(user, "create", { type: "polls", opinionAuthorId: user.id })) {
      deny(false);
    }
    try {
      const poll = await store.insert("polls", { opinion_id: str(opinion, "id") });
      for (const [index, optionText] of pollOptions.entries()) {
        await store.insert("poll_options", {
          poll_id: str(poll, "id"),
          option_text: optionText,
          position: index,
        });
      }
    } catch (error) {
      mapStoreError(error);
    }
  }
  return toOpinionView(store, caller.user, opinion);
}

export interface OpinionListParams {
  topic?: string;
  search?: string;
  authorId?: string;
  limit: number;
  cursor: Cursor | null;
}

export async function listOpinions(
  store: Store,
  caller: Caller,
  params: OpinionListParams,
): Promise<Page<OpinionView>> {
  const filters: string[] = [];
  if (params.topic !== undefined) {
    filters.push(eqFilter("topic", validateTopic(params.topic)));
  }
  if (params.authorId !== undefined) {
    filters.push(eqFilter("author_id", params.authorId));
  }
  const search = validateSearch(params.search);
  if (search !== null) {
    // Search matches opinion bodies only (see docs/api-conventions.md);
    // topic search is the topic filter above. One ilike filter keeps
    // the query auditable and avoids an OR that widens the scan.
    filters.push(ilikeFilter("body", search));
  }
  const result = await store.list("opinions", {
    filters,
    cursor: params.cursor,
    limit: params.limit,
  });
  const items: OpinionView[] = [];
  for (const row of result.rows) {
    items.push(await toOpinionView(store, caller.user, row));
  }
  return { items, nextCursor: result.nextCursor };
}

export async function getOpinion(
  store: Store,
  caller: Caller,
  id: string,
): Promise<OpinionView> {
  if (!can(caller.user, "read", { type: "opinions" })) {
    deny(false);
  }
  const row = await loadRow(store, "opinions", id);
  return toOpinionView(store, caller.user, row);
}

export async function updateOpinion(
  store: Store,
  caller: Caller,
  id: string,
  body: Record<string, unknown>,
): Promise<OpinionView> {
  const user = requireUser(caller);
  assertAllowedKeys(body, ["body", "topic"]);
  // is_anonymous is deliberately NOT updatable: flipping it after
  // posting would de-anonymise (or retro-anonymise) a public post.
  const existing = await loadRow(store, "opinions", id);
  if (nullableStr(existing, "author_id") !== user.id) {
    deny(false);
  }
  if (!can(user, "update", { type: "opinions", ownerId: user.id })) {
    deny(false);
  }
  const patch: Row = {};
  if (body.body !== undefined) {
    patch.body = validateText(body.body, "body");
  }
  if (body.topic !== undefined) {
    patch.topic = validateTopic(body.topic);
  }
  if (Object.keys(patch).length === 0) {
    throw badRequest("Nothing to update");
  }
  const updated = await store.update("opinions", id, patch);
  if (updated === null) {
    throw notFound();
  }
  return toOpinionView(store, caller.user, updated);
}

export async function deleteOpinion(
  store: Store,
  caller: Caller,
  id: string,
): Promise<void> {
  const user = requireUser(caller);
  const existing = await loadRow(store, "opinions", id);
  if (nullableStr(existing, "author_id") !== user.id) {
    deny(false);
  }
  if (!can(user, "delete", { type: "opinions", ownerId: user.id })) {
    deny(false);
  }
  await store.remove("opinions", id);
}

// ---------------------------------------------------------------- replies

export async function createReply(
  store: Store,
  caller: Caller,
  opinionId: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof replyView>> {
  const user = requireUser(caller);
  assertAllowedKeys(body, ["body", "side"]);
  const text = validateText(body.body, "body");
  const side: Side = body.side === undefined ? "neutral" : validateSide(body.side);
  await loadRow(store, "opinions", opinionId);
  if (!can(user, "create", { type: "replies", ownerId: user.id })) {
    deny(false);
  }
  let reply: Row;
  try {
    reply = await store.insert("replies", {
      opinion_id: opinionId,
      author_id: user.id,
      body: text,
      side,
    });
  } catch (error) {
    mapStoreError(error);
  }
  const authorRow = await loadAuthor(store, user.id);
  return replyView(reply, authorRow, false);
}

export async function listReplies(
  store: Store,
  caller: Caller,
  opinionId: string,
  params: { side?: string; sort?: string; limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof replyView>>> {
  if (!can(caller.user, "read", { type: "replies" })) {
    deny(false);
  }
  await loadRow(store, "opinions", opinionId);
  const filters: string[] = [eqFilter("opinion_id", opinionId)];
  if (params.side !== undefined) {
    filters.push(eqFilter("side", validateSide(params.side)));
  }
  // Best Argument = voice_score desc (V1 rule, migration 02).
  const order =
    params.sort === "best" ? "voice_score.desc,created_at.desc,id.desc" : undefined;
  const result = await store.list("replies", {
    filters,
    cursor: params.cursor,
    limit: params.limit,
    order,
  });
  const items: ReturnType<typeof replyView>[] = [];
  for (const row of result.rows) {
    const authorRow = await loadAuthor(store, nullableStr(row, "author_id"));
    let ownLiked = false;
    if (caller.user !== null) {
      ownLiked =
        (await store.getBy("reply_likes", [
          eqFilter("user_id", caller.user.id),
          eqFilter("reply_id", str(row, "id")),
        ])) !== null;
    }
    items.push(replyView(row, authorRow, ownLiked));
  }
  return { items, nextCursor: result.nextCursor };
}

// ---------------------------------------------------------------- stance / likes

export async function setStance(
  store: Store,
  caller: Caller,
  opinionId: string,
  stanceInput: unknown,
): Promise<{ opinionId: string; stance: Stance }> {
  const user = requireUser(caller);
  const stance = validateStance(stanceInput);
  await loadRow(store, "opinions", opinionId);
  if (!can(user, "create", { type: "opinion_votes", ownerId: user.id })) {
    deny(false);
  }
  const existing = await store.getBy("opinion_votes", [
    eqFilter("user_id", user.id),
    eqFilter("opinion_id", opinionId),
  ]);
  try {
    if (existing !== null) {
      if (!can(user, "update", { type: "opinion_votes", ownerId: user.id })) {
        deny(false);
      }
      // Composite-key row: update via remove+insert through the
      // store's filter path, because update() is id-keyed.
      await store.removeBy("opinion_votes", [
        eqFilter("user_id", user.id),
        eqFilter("opinion_id", opinionId),
      ]);
    }
    await store.insert("opinion_votes", {
      user_id: user.id,
      opinion_id: opinionId,
      stance,
    });
  } catch (error) {
    mapStoreError(error);
  }
  return { opinionId, stance };
}

export async function removeStance(
  store: Store,
  caller: Caller,
  opinionId: string,
): Promise<void> {
  const user = requireUser(caller);
  const existing = await store.getBy("opinion_votes", [
    eqFilter("user_id", user.id),
    eqFilter("opinion_id", opinionId),
  ]);
  if (existing === null) {
    throw notFound();
  }
  if (!can(user, "delete", { type: "opinion_votes", ownerId: user.id })) {
    deny(true);
  }
  await store.removeBy("opinion_votes", [
    eqFilter("user_id", user.id),
    eqFilter("opinion_id", opinionId),
  ]);
}

async function likeTarget(
  store: Store,
  caller: Caller,
  table: TableName,
  targetKey: string,
  targetId: string,
  parentTable: string,
): Promise<void> {
  const user = requireUser(caller);
  await loadRow(store, parentTable, targetId);
  if (!can(user, "create", { type: table, ownerId: user.id })) {
    deny(false);
  }
  const existing = await store.getBy(table, [
    eqFilter("user_id", user.id),
    eqFilter(targetKey, targetId),
  ]);
  if (existing !== null) {
    throw conflict("Already liked");
  }
  try {
    await store.insert(table, { user_id: user.id, [targetKey]: targetId });
  } catch (error) {
    mapStoreError(error);
  }
}

async function unlikeTarget(
  store: Store,
  caller: Caller,
  table: TableName,
  targetKey: string,
  targetId: string,
): Promise<void> {
  const user = requireUser(caller);
  const existing = await store.getBy(table, [
    eqFilter("user_id", user.id),
    eqFilter(targetKey, targetId),
  ]);
  if (existing === null) {
    throw notFound();
  }
  if (!can(user, "delete", { type: table, ownerId: user.id })) {
    deny(true);
  }
  await store.removeBy(table, [
    eqFilter("user_id", user.id),
    eqFilter(targetKey, targetId),
  ]);
}

export function likeOpinion(
  store: Store,
  caller: Caller,
  opinionId: string,
): Promise<void> {
  return likeTarget(store, caller, "opinion_likes", "opinion_id", opinionId, "opinions");
}

export function unlikeOpinion(
  store: Store,
  caller: Caller,
  opinionId: string,
): Promise<void> {
  return unlikeTarget(store, caller, "opinion_likes", "opinion_id", opinionId);
}

export function likeReply(store: Store, caller: Caller, replyId: string): Promise<void> {
  return likeTarget(store, caller, "reply_likes", "reply_id", replyId, "replies");
}

export function unlikeReply(
  store: Store,
  caller: Caller,
  replyId: string,
): Promise<void> {
  return unlikeTarget(store, caller, "reply_likes", "reply_id", replyId);
}

// ---------------------------------------------------------------- reposts

export async function createRepost(
  store: Store,
  caller: Caller,
  opinionId: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof repostView>> {
  const user = requireUser(caller);
  assertAllowedKeys(body, ["quote_take"]);
  const quoteTake = validateOptionalText(body.quote_take, "quote_take");
  await loadRow(store, "opinions", opinionId);
  if (!can(user, "create", { type: "reposts", ownerId: user.id })) {
    deny(false);
  }
  const existing = await store.getBy("reposts", [
    eqFilter("user_id", user.id),
    eqFilter("opinion_id", opinionId),
  ]);
  if (existing !== null) {
    throw conflict("Already reposted");
  }
  let repost: Row;
  try {
    repost = await store.insert("reposts", {
      user_id: user.id,
      opinion_id: opinionId,
      quote_take: quoteTake,
    });
  } catch (error) {
    mapStoreError(error);
  }
  return toRepostView(store, caller.user, repost);
}

export async function listRepostsByOpinion(
  store: Store,
  caller: Caller,
  opinionId: string,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof repostView>>> {
  if (!can(caller.user, "read", { type: "reposts" })) {
    deny(false);
  }
  await loadRow(store, "opinions", opinionId);
  const result = await store.list("reposts", {
    filters: [eqFilter("opinion_id", opinionId)],
    cursor: params.cursor,
    limit: params.limit,
  });
  const items: ReturnType<typeof repostView>[] = [];
  for (const row of result.rows) {
    items.push(await toRepostView(store, caller.user, row));
  }
  return { items, nextCursor: result.nextCursor };
}

export async function listRepostsByUser(
  store: Store,
  caller: Caller,
  userId: string,
  params: { limit: number; cursor: Cursor | null },
): Promise<Page<ReturnType<typeof repostView>>> {
  // Reposts are public reads (profile Reposts tab), so a user id
  // here is a public profile id, not a private-row lookup.
  if (!can(caller.user, "read", { type: "reposts" })) {
    deny(false);
  }
  await loadRow(store, "profiles", userId);
  const result = await store.list("reposts", {
    filters: [eqFilter("user_id", userId)],
    cursor: params.cursor,
    limit: params.limit,
  });
  const items: ReturnType<typeof repostView>[] = [];
  for (const row of result.rows) {
    items.push(await toRepostView(store, caller.user, row));
  }
  return { items, nextCursor: result.nextCursor };
}
