/**
 * Layer 5 — thin API route handlers. Handlers parse the path,
 * query, and body, resolve the caller, and call a service. They
 * contain NO business logic, NO permission logic, and NO
 * serialisation of their own — all of that lives in
 * src/services/api.ts / api2.ts / serializers.ts.
 *
 * HIDDEN API — read this before adding a route:
 * - There is NO /api/docs, NO OpenAPI/spec endpoint, NO endpoint
 *   listing route, and NO route that enumerates users, handles,
 *   or emails. API documentation lives only in
 *   docs/api-conventions.md in the repo, never served publicly.
 * - Unknown /api paths return the same generic 404 as any other
 *   unknown path, so probing cannot distinguish "no such route"
 *   from "route exists but you may not use it" beyond the auth
 *   behaviour of real routes.
 * - Identity: the caller is the Layer 4 verified session only.
 *   A Bearer token that GoTrue rejects is a 401, even on a
 *   public read — a presented-but-invalid credential is not
 *   silently downgraded to a visitor.
 * - CORS: same-origin / APP_ORIGIN only, never "*"
 *   (src/lib/cors.ts). A refused origin gets a generic 403 and
 *   no CORS headers.
 */

import type { AuthUser } from "../lib/auth.js";
import {
  AuthUnavailableError,
  extractBearerToken,
  getAuthConfig,
  verifySession,
  type AuthConfig,
} from "../lib/auth.js";
import {
  ApiError,
  assertAllowedKeys,
  errorBody,
  parseJsonBody,
  toApiError,
  unavailable,
} from "../lib/http.js";
import { corsHeaders } from "../lib/cors.js";
import { logRequest, newRequestId, SECURITY_HEADERS } from "../lib/log.js";
import { bucketForApiRoute, hashKeyPart, type RateLimiter } from "../lib/rateLimit.js";
import { decodeCursor, parseLimit } from "../lib/pagination.js";
import { isUuid } from "../lib/validation.js";
import { RestStore, type Store } from "../db/store.js";
import * as api from "../services/api.js";
import * as api2 from "../services/api2.js";

export interface ApiDeps {
  /** Injected for tests; production uses verifySession + RestStore. */
  verify?: (token: string | null, config: AuthConfig) => Promise<AuthUser | null>;
  store?: (token: string | null) => Store;
  appOrigin?: string;
  /** Layer 11 limiter; absent means un-limited (test isolation only). */
  rateLimiter?: RateLimiter;
  /** Direct socket address from server.ts, hashed before keying. */
  clientIp?: string | null;
}

export interface ApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

interface Parts {
  segments: string[];
  query: URLSearchParams;
}

function splitPath(pathname: string): Parts {
  const [path, queryString] = pathname.split("?");
  const segments = (path ?? "").split("/").filter((segment) => segment !== "");
  return { segments, query: new URLSearchParams(queryString ?? "") };
}

function json(
  statusCode: number,
  data: unknown,
  extra: Record<string, string> = {},
): ApiResult {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, ...extra },
    body: JSON.stringify({ data }),
  };
}

function empty(statusCode: number, extra: Record<string, string> = {}): ApiResult {
  return { statusCode, headers: { ...SECURITY_HEADERS, ...extra }, body: "" };
}

function fail(error: ApiError, extra: Record<string, string> = {}): ApiResult {
  const retry: Record<string, string> =
    error.retryAfterSeconds !== undefined
      ? { "retry-after": String(error.retryAfterSeconds) }
      : {};
  return {
    statusCode: error.status,
    headers: { ...SECURITY_HEADERS, ...retry, ...extra },
    body: errorBody(error),
  };
}

async function resolveCaller(
  deps: ApiDeps,
  authorization: string | null | undefined,
): Promise<{ user: AuthUser | null; token: string | null }> {
  const token = extractBearerToken(authorization);
  if (token === null) {
    return { user: null, token: null };
  }
  try {
    let user: AuthUser | null;
    if (deps.verify !== undefined) {
      user = await deps.verify(token, {
        supabaseUrl: "https://example.supabase.co",
        anonKey: "placeholder-not-a-real-key",
      });
    } else {
      const config = getAuthConfig({
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      });
      user = await verifySession(token, config);
    }
    if (user === null) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue");
    }
    return { user, token };
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      throw unavailable();
    }
    throw error;
  }
}

function makeStore(deps: ApiDeps, token: string | null): Store {
  if (deps.store !== undefined) {
    return deps.store(token);
  }
  // Missing env is a service problem, not a client error: map it
  // to a generic 503 (the missing variable's NAME is never sent
  // to the client — getAuthConfig's message stays server-side).
  try {
    const config = getAuthConfig({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    });
    return new RestStore(config, token);
  } catch {
    throw unavailable();
  }
}

function requireUuid(value: string): string {
  if (!isUuid(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", "id must be a valid id");
  }
  return value;
}

function pageParams(query: URLSearchParams): {
  limit: number;
  cursor: ReturnType<typeof decodeCursor>;
} {
  return {
    limit: parseLimit(query.get("limit")),
    cursor: decodeCursor(query.get("cursor")),
  };
}

/**
 * Dispatch one API request. Returns a result; never throws for a
 * client error (those become the single error shape). Only the
 * server's catch-all turns an unexpected throw into a generic 500.
 */
export async function handleApi(
  method: string,
  pathname: string,
  headers: { authorization?: string | null; origin?: string | null },
  bodyText: string | null,
  deps: ApiDeps = {},
): Promise<ApiResult> {
  const requestId = newRequestId();
  const { segments, query } = splitPath(pathname);
  const cors = corsHeaders(headers.origin ?? null, deps.appOrigin);
  if (cors === null) {
    logRequest({ requestId, route: "/api/*", method, status: 403, userId: null });
    return fail(new ApiError(403, "FORBIDDEN", "Not allowed"));
  }
  const routePattern = `/api/${segments.slice(1, 3).join("/")}`;
  try {
    const { result, userId } = await dispatch(
      method,
      segments,
      query,
      headers,
      bodyText,
      deps,
    );
    logRequest({
      requestId,
      route: routePattern,
      method,
      status: result.statusCode,
      userId,
    });
    return { ...result, headers: { ...result.headers, ...cors } };
  } catch (error) {
    const apiError = toApiError(error);
    logRequest({
      requestId,
      route: routePattern,
      method,
      status: apiError.status,
      userId: null,
    });
    return fail(apiError, cors);
  }
}

/**
 * Route-table check, pattern only (no ids, no auth, no store).
 * Dispatch runs this FIRST so an unknown path — including a
 * probed /api/docs or /api/openapi — gets the generic 404 even
 * when the app is unconfigured (no env) or the caller is
 * unauthenticated. Routing must never leak, via a 503 or a 401,
 * whether an unknown path is "almost" a route.
 */
function routeExists(method: string, rest: string[]): boolean {
  const at = (index: number, value: string): boolean => rest[index] === value;
  if (rest[0] === "profiles" && rest.length === 2 && method === "GET") return true;
  if (rest[0] === "profiles" && rest.length === 2 && method === "PATCH") return true;
  if (rest[0] === "profiles" && rest.length === 3 && at(2, "reposts") && method === "GET")
    return true;
  if (
    rest[0] === "profiles" &&
    rest.length === 3 &&
    at(2, "opinions") &&
    method === "GET"
  )
    return true;
  if (
    rest[0] === "opinions" &&
    rest.length === 1 &&
    (method === "GET" || method === "POST")
  )
    return true;
  if (
    rest[0] === "opinions" &&
    rest.length === 2 &&
    ["GET", "PATCH", "DELETE"].includes(method)
  )
    return true;
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    ["replies", "stance", "like", "reposts", "polls"].includes(rest[2] as string)
  )
    return true;
  if (rest[0] === "replies" && rest.length === 3 && at(2, "like")) return true;
  if (rest[0] === "follows" && (rest.length === 1 || rest.length === 2)) return true;
  if (rest[0] === "polls" && rest.length === 3 && at(2, "votes")) return true;
  if (rest[0] === "bookmarks" && (rest.length === 1 || rest.length === 2)) return true;
  if (rest[0] === "muted-topics" && (rest.length === 1 || rest.length === 2)) return true;
  if (rest[0] === "muted-words" && (rest.length === 1 || rest.length === 2)) return true;
  if (rest[0] === "blocks" && (rest.length === 1 || rest.length === 2)) return true;
  if (rest[0] === "reports" && (rest.length === 1 || rest.length === 2)) return true;
  if (rest[0] === "notifications" && rest.length === 1 && method === "GET") return true;
  if (rest[0] === "notifications" && rest.length === 2 && method === "PATCH") return true;
  if (rest[0] === "daily-questions" && rest.length === 1 && method === "GET") return true;
  if (rest[0] === "daily-questions" && rest.length === 2 && method === "GET") return true;
  return false;
}

async function dispatch(
  method: string,
  segments: string[],
  query: URLSearchParams,
  headers: { authorization?: string | null },
  bodyText: string | null,
  deps: ApiDeps,
): Promise<{ result: ApiResult; userId: string | null }> {
  // segments[0] is "api" (enforced by the caller in app.ts).
  const rest = segments.slice(1);
  if (!routeExists(method, rest)) {
    throw new ApiError(404, "NOT_FOUND", "Not found");
  }
  const caller = await resolveCaller(deps, headers.authorization);
  // Layer 11: after the route-table 404 and after caller
  // resolution (so a presented-but-rejected token is 401, not
  // 429), before any store call. Key by user id when a session
  // exists, otherwise by hashed IP — never the raw IP.
  if (deps.rateLimiter !== undefined) {
    const key =
      caller.user !== null
        ? `user:${caller.user.id}`
        : `ip:${hashKeyPart(deps.clientIp ?? "unknown")}`;
    await deps.rateLimiter.check(
      bucketForApiRoute(method, rest, query.has("search")),
      key,
    );
  }
  const store = makeStore(deps, caller.token);
  const ctx: api.Caller = { user: caller.user };
  const userId = caller.user?.id ?? null;
  const body = (): Record<string, unknown> => parseJsonBody(bodyText);
  // Wrap every return below: handlers return ApiResult, dispatch
  // adds the caller id for the redacted log line.
  const wrap = (result: ApiResult): { result: ApiResult; userId: string | null } => ({
    result,
    userId,
  });

  // -- profiles ------------------------------------------------------
  if (rest[0] === "profiles" && rest.length === 2 && method === "GET") {
    const profile = await api.getProfile(store, ctx, requireUuid(rest[1] as string));
    return wrap(json(200, profile));
  }
  if (rest[0] === "profiles" && rest.length === 2 && method === "PATCH") {
    const profile = await api.updateProfile(
      store,
      ctx,
      requireUuid(rest[1] as string),
      body(),
    );
    return wrap(json(200, profile));
  }
  if (
    rest[0] === "profiles" &&
    rest.length === 3 &&
    rest[2] === "reposts" &&
    method === "GET"
  ) {
    const page = await api.listRepostsByUser(
      store,
      ctx,
      requireUuid(rest[1] as string),
      pageParams(query),
    );
    return wrap(json(200, page));
  }
  if (
    rest[0] === "profiles" &&
    rest.length === 3 &&
    rest[2] === "opinions" &&
    method === "GET"
  ) {
    const page = await api.listOpinions(store, ctx, {
      authorId: requireUuid(rest[1] as string),
      ...pageParams(query),
    });
    return wrap(json(200, page));
  }

  // -- opinions ------------------------------------------------------
  if (rest[0] === "opinions" && rest.length === 1 && method === "GET") {
    const page = await api.listOpinions(store, ctx, {
      topic: query.get("topic") ?? undefined,
      search: query.get("search") ?? undefined,
      ...pageParams(query),
    });
    return wrap(json(200, page));
  }
  if (rest[0] === "opinions" && rest.length === 1 && method === "POST") {
    const created = await api.createOpinion(
      store,
      ctx,
      body() as unknown as api.OpinionInput,
    );
    return wrap(json(201, created));
  }
  if (rest[0] === "opinions" && rest.length === 2 && method === "GET") {
    const opinion = await api.getOpinion(store, ctx, requireUuid(rest[1] as string));
    return wrap(json(200, opinion));
  }
  if (rest[0] === "opinions" && rest.length === 2 && method === "PATCH") {
    const opinion = await api.updateOpinion(
      store,
      ctx,
      requireUuid(rest[1] as string),
      body(),
    );
    return wrap(json(200, opinion));
  }
  if (rest[0] === "opinions" && rest.length === 2 && method === "DELETE") {
    await api.deleteOpinion(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "replies" &&
    method === "GET"
  ) {
    const page = await api.listReplies(store, ctx, requireUuid(rest[1] as string), {
      side: query.get("side") ?? undefined,
      sort: query.get("sort") ?? undefined,
      ...pageParams(query),
    });
    return wrap(json(200, page));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "replies" &&
    method === "POST"
  ) {
    const reply = await api.createReply(
      store,
      ctx,
      requireUuid(rest[1] as string),
      body(),
    );
    return wrap(json(201, reply));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "stance" &&
    method === "POST"
  ) {
    const stanceBody = body();
    assertAllowedKeys(stanceBody, ["stance"]);
    const result = await api.setStance(
      store,
      ctx,
      requireUuid(rest[1] as string),
      stanceBody.stance,
    );
    return wrap(json(200, result));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "stance" &&
    method === "DELETE"
  ) {
    await api.removeStance(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "like" &&
    method === "POST"
  ) {
    await api.likeOpinion(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "like" &&
    method === "DELETE"
  ) {
    await api.unlikeOpinion(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "reposts" &&
    method === "GET"
  ) {
    const page = await api.listRepostsByOpinion(
      store,
      ctx,
      requireUuid(rest[1] as string),
      pageParams(query),
    );
    return wrap(json(200, page));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "reposts" &&
    method === "POST"
  ) {
    const repost = await api.createRepost(
      store,
      ctx,
      requireUuid(rest[1] as string),
      body(),
    );
    return wrap(json(201, repost));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "polls" &&
    method === "GET"
  ) {
    const poll = await api2.getPollByOpinion(store, ctx, requireUuid(rest[1] as string));
    return wrap(json(200, poll));
  }
  if (
    rest[0] === "opinions" &&
    rest.length === 3 &&
    rest[2] === "polls" &&
    method === "POST"
  ) {
    const poll = await api2.createPoll(
      store,
      ctx,
      requireUuid(rest[1] as string),
      body(),
    );
    return wrap(json(201, poll));
  }

  // -- reply likes ----------------------------------------------------
  if (
    rest[0] === "replies" &&
    rest.length === 3 &&
    rest[2] === "like" &&
    method === "POST"
  ) {
    await api.likeReply(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }
  if (
    rest[0] === "replies" &&
    rest.length === 3 &&
    rest[2] === "like" &&
    method === "DELETE"
  ) {
    await api.unlikeReply(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }

  // -- follows --------------------------------------------------------
  if (rest[0] === "follows" && rest.length === 1 && method === "POST") {
    const followBody = body();
    assertAllowedKeys(followBody, ["following_id"]);
    const followingId = followBody.following_id;
    if (typeof followingId !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "following_id must be a string");
    }
    await api2.follow(store, ctx, requireUuid(followingId));
    return wrap(empty(204));
  }
  if (rest[0] === "follows" && rest.length === 2 && method === "DELETE") {
    await api2.unfollow(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }

  // -- polls ----------------------------------------------------------
  if (
    rest[0] === "polls" &&
    rest.length === 3 &&
    rest[2] === "votes" &&
    method === "POST"
  ) {
    const voteBody = body();
    assertAllowedKeys(voteBody, ["option_id"]);
    const optionId = voteBody.option_id;
    if (typeof optionId !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "option_id must be a string");
    }
    const poll = await api2.castPollVote(
      store,
      ctx,
      requireUuid(rest[1] as string),
      requireUuid(optionId),
    );
    return wrap(json(200, poll));
  }
  if (
    rest[0] === "polls" &&
    rest.length === 3 &&
    rest[2] === "votes" &&
    method === "DELETE"
  ) {
    await api2.undoPollVote(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }

  // -- bookmarks ------------------------------------------------------
  if (rest[0] === "bookmarks" && rest.length === 1 && method === "GET") {
    const page = await api2.listBookmarks(store, ctx, pageParams(query));
    return wrap(json(200, page));
  }
  if (rest[0] === "bookmarks" && rest.length === 1 && method === "POST") {
    const bookmarkBody = body();
    assertAllowedKeys(bookmarkBody, ["opinion_id"]);
    const opinionId = bookmarkBody.opinion_id;
    if (typeof opinionId !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "opinion_id must be a string");
    }
    await api2.bookmark(store, ctx, requireUuid(opinionId));
    return wrap(empty(204));
  }
  if (rest[0] === "bookmarks" && rest.length === 2 && method === "DELETE") {
    await api2.unbookmark(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }

  // -- muted topics / words -------------------------------------------
  if (rest[0] === "muted-topics" && rest.length === 1 && method === "GET") {
    const page = await api2.listMutedTopics(store, ctx, pageParams(query));
    return wrap(json(200, page));
  }
  if (rest[0] === "muted-topics" && rest.length === 1 && method === "POST") {
    const muteTopicBody = body();
    assertAllowedKeys(muteTopicBody, ["topic"]);
    const topic = muteTopicBody.topic;
    if (typeof topic !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "topic must be a string");
    }
    await api2.muteTopic(store, ctx, topic);
    return wrap(empty(204));
  }
  if (rest[0] === "muted-topics" && rest.length === 2 && method === "DELETE") {
    await api2.unmuteTopic(store, ctx, decodeURIComponent(rest[1] as string));
    return wrap(empty(204));
  }
  if (rest[0] === "muted-words" && rest.length === 1 && method === "GET") {
    const page = await api2.listMutedWords(store, ctx, pageParams(query));
    return wrap(json(200, page));
  }
  if (rest[0] === "muted-words" && rest.length === 1 && method === "POST") {
    const muteWordBody = body();
    assertAllowedKeys(muteWordBody, ["word"]);
    const word = muteWordBody.word;
    if (typeof word !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "word must be a string");
    }
    await api2.muteWord(store, ctx, word);
    return wrap(empty(204));
  }
  if (rest[0] === "muted-words" && rest.length === 2 && method === "DELETE") {
    await api2.unmuteWord(store, ctx, decodeURIComponent(rest[1] as string));
    return wrap(empty(204));
  }

  // -- blocks ----------------------------------------------------------
  if (rest[0] === "blocks" && rest.length === 1 && method === "GET") {
    const page = await api2.listBlocks(store, ctx, pageParams(query));
    return wrap(json(200, page));
  }
  if (rest[0] === "blocks" && rest.length === 1 && method === "POST") {
    const blockBody = body();
    assertAllowedKeys(blockBody, ["blocked_id"]);
    const blockedId = blockBody.blocked_id;
    if (typeof blockedId !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "blocked_id must be a string");
    }
    await api2.block(store, ctx, requireUuid(blockedId));
    return wrap(empty(204));
  }
  if (rest[0] === "blocks" && rest.length === 2 && method === "DELETE") {
    await api2.unblock(store, ctx, requireUuid(rest[1] as string));
    return wrap(empty(204));
  }

  // -- reports ---------------------------------------------------------
  if (rest[0] === "reports" && rest.length === 1 && method === "GET") {
    const page = await api2.listReports(store, ctx, pageParams(query));
    return wrap(json(200, page));
  }
  if (rest[0] === "reports" && rest.length === 1 && method === "POST") {
    const report = await api2.createReport(store, ctx, body());
    return wrap(json(201, report));
  }
  if (rest[0] === "reports" && rest.length === 2 && method === "GET") {
    const report = await api2.getReport(store, ctx, requireUuid(rest[1] as string));
    return wrap(json(200, report));
  }

  // -- notifications (read + mark-read ONLY; no POST route exists) ---
  if (rest[0] === "notifications" && rest.length === 1 && method === "GET") {
    const page = await api2.listNotifications(store, ctx, {
      type: query.get("type") ?? undefined,
      ...pageParams(query),
    });
    return wrap(json(200, page));
  }
  if (rest[0] === "notifications" && rest.length === 2 && method === "PATCH") {
    const note = await api2.markNotificationRead(
      store,
      ctx,
      requireUuid(rest[1] as string),
      body(),
    );
    return wrap(json(200, note));
  }

  // -- daily questions (read-only for users) ---------------------------
  if (rest[0] === "daily-questions" && rest.length === 1 && method === "GET") {
    const page = await api2.listDailyQuestions(store, ctx, pageParams(query));
    return wrap(json(200, page));
  }
  if (rest[0] === "daily-questions" && rest.length === 2 && method === "GET") {
    const question = await api2.getDailyQuestion(
      store,
      ctx,
      requireUuid(rest[1] as string),
    );
    return wrap(json(200, question));
  }

  // Deliberately no route for: POST /api/notifications, POST/DELETE
  // /api/daily-questions, GET /api/profiles (list), /api/docs,
  // /api/openapi, or any endpoint listing. Unknown paths fall
  // through to the generic 404 below.
  throw new ApiError(404, "NOT_FOUND", "Not found");
}
