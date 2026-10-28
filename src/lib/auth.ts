/**
 * Supabase Auth (GoTrue) — server-side session verification.
 *
 * Proven provider only. No hand-rolled password hashing, no session
 * invention, no local JWT signature verification: the anon key is
 * NOT a signing secret, so a locally "verified" signature would be
 * fake security. The only verification here is asking GoTrue itself
 * (GET /auth/v1/user) whether the token is a live session.
 *
 * Zero new runtime dependencies: the global fetch is enough for
 * this one call. See docs/decisions/0008-layer4-auth.md for why
 * @supabase/supabase-js was rejected for this server layer.
 *
 * Secrets rule: tokens and keys are never logged, never returned in
 * error messages, and never stored by this module. Callers pass a
 * token in and get a user (or null) back; nothing else.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  /** Supabase provider, e.g. "email" or "google", when GoTrue reports it. */
  provider: string | null;
}

export interface AuthEnv {
  SUPABASE_URL?: string | undefined;
  SUPABASE_ANON_KEY?: string | undefined;
}

export interface AuthConfig {
  supabaseUrl: string;
  anonKey: string;
}

/** Error thrown when GoTrue itself cannot be reached. Never carries a token. */
export class AuthUnavailableError extends Error {
  constructor() {
    super("Auth service unavailable: could not reach Supabase Auth");
    this.name = "AuthUnavailableError";
  }
}

/**
 * Resolve auth configuration from env values. Fails clearly and
 * loudly when a variable is missing — a session is never faked
 * from a placeholder. This does NOT make the variables required at
 * server startup (the landing page still serves without them); it
 * makes them required at the moment auth is actually used.
 */
export function getAuthConfig(env: AuthEnv): AuthConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  const missing: string[] = [];
  if (supabaseUrl === undefined || supabaseUrl === "") {
    missing.push("SUPABASE_URL");
  }
  if (anonKey === undefined || anonKey === "") {
    missing.push("SUPABASE_ANON_KEY");
  }
  if (missing.length > 0) {
    throw new Error(
      `Supabase auth is not configured: set ${missing.join(" and ")} ` +
        `in .env (never commit .env, never put the service_role key here).`,
    );
  }
  // TypeScript cannot narrow the trimmed locals above, so re-read
  // through the checked values explicitly.
  return {
    supabaseUrl: supabaseUrl as string,
    anonKey: anonKey as string,
  };
}

/**
 * Extract a Bearer token from an Authorization header. Returns null
 * for a missing, empty, or malformed header — never throws, never
 * logs the header value.
 */
export function extractBearerToken(
  authorization: string | null | undefined,
): string | null {
  if (authorization === null || authorization === undefined) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (match === null || match[1] === undefined) {
    return null;
  }
  return match[1];
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Verify a session token with GoTrue.
 *
 * - Returns the AuthUser when GoTrue accepts the token.
 * - Returns null when the token is missing, empty, expired, or
 *   rejected by GoTrue (any non-2xx response), or when GoTrue
 *   returns a body without a usable user id.
 * - Throws AuthUnavailableError only when GoTrue cannot be reached
 *   at all (network failure). A network failure is not a "no user"
 *   answer — callers must surface it as a 503, not as a 401.
 *
 * The fetch implementation is injectable for tests only; production
 * callers omit it and use the global fetch.
 */
export async function verifySession(
  token: string | null | undefined,
  config: AuthConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<AuthUser | null> {
  if (token === null || token === undefined || token.trim() === "") {
    return null;
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(`${base}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token.trim()}`,
      },
    });
  } catch {
    throw new AuthUnavailableError();
  }
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as {
    id?: unknown;
    email?: unknown;
    app_metadata?: { provider?: unknown } | null;
  };
  if (typeof body.id !== "string" || body.id === "") {
    return null;
  }
  return {
    id: body.id,
    email: typeof body.email === "string" ? body.email : null,
    provider:
      typeof body.app_metadata?.provider === "string" ? body.app_metadata.provider : null,
  };
}

/**
 * Map an auth/permission denial to the playbook's HTTP status.
 *
 * - No user at all -> 401 (unauthenticated).
 * - A signed-in user asking for another user's PRIVATE row
 *   (bookmarks, votes, mutes, blocks, reports, notifications) ->
 *   404, not 403 and not the data. Returning 403 would confirm
 *   the row exists; returning the row would leak it.
 * - A signed-in user forbidden on a row that is public or whose
 *   existence is not secret (e.g. voting twice is a DB rule, or
 *   writing to a server-only table) -> 403 (unauthorised).
 *
 * Callers must choose the branch honestly: privateResource must be
 * true only for rows that are private to one user (see
 * docs/permissions.md). Using 404 for a public row to hide an
 * error would be misleading, not secure.
 */
export function deniedStatus(
  user: AuthUser | null,
  opts: { privateResource: boolean },
): 401 | 403 | 404 {
  if (user === null) {
    return 401;
  }
  return opts.privateResource ? 404 : 403;
}
