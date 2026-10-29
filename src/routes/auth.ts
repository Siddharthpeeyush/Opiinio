/**
 * Server auth routes — thin handlers under /api/auth/*.
 *
 * This is the ONLY path from the frontend to Supabase Auth.
 * The frontend must never call GoTrue/PostgREST directly (that
 * would bypass Layer 5 anonymous masking and put the anon key
 * in client code); it calls these routes, and these routes
 * proxy to GoTrue from the server (src/services/authService.ts
 * + src/lib/mfa.ts) with the anon key.
 *
 * HIDDEN API, same as Layer 5: no /api/auth/docs, no listing
 * route. Unknown /api/auth paths get the generic 404, and the
 * route-table check runs BEFORE env/config so a probe cannot
 * learn, via a 503, whether a path is "almost" a route.
 *
 * PRIVACY, same rules as Layer 5:
 * - Tokens, passwords, codes, and emails are never logged
 *   (src/lib/log.ts carries request id, route pattern, method,
 *   status, user id only) and GoTrue raw errors are never
 *   returned (generic shape only, src/lib/http.ts).
 * - Bad credentials are one generic 401; password-reset always
 *   answers { sent: true } when GoTrue is reachable (no
 *   email-existence oracle); signup failures are generic.
 * - Session data returned is the caller's OWN session/user only,
 *   for their own account screen. MFA enrollment secrets are
 *   returned once, to the enrolling user only, and the frontend
 *   must discard them after verification (never store/log them).
 * - CORS: same-origin / APP_ORIGIN only, never "*" (Layer 5).
 * - Rate-limit hook: Layer 11 owns the shared store; these
 *   routes call an optional deps.rateLimit hook before GoTrue
 *   on signup / signin / reset / refresh / Google start /
 *   MFA challenge / MFA verify / password change / account
 *   deletion, so the limiter can wrap them without a rewrite.
 *   The default (no hook) is no limiting — recorded honestly
 *   in docs/decisions/0011-server-auth-routes.md, not hidden.
 * - Account deletion: aal-gated, then SERVER_ONLY (see
 *   authService.deleteAccountServerOnly) — GoTrue admin
 *   deletion needs the service_role key, which is never wired
 *   here. The route proves the gate, then stops honestly.
 */

import {
  AuthUnavailableError,
  extractBearerToken,
  getAuthConfig,
  verifySession,
  type AuthConfig,
  type AuthUser,
} from "../lib/auth.js";
import {
  ApiError,
  assertAllowedKeys,
  errorBody,
  forbidden,
  parseJsonBody,
  toApiError,
  unauthenticated,
  unavailable,
} from "../lib/http.js";
import { corsHeaders } from "../lib/cors.js";
import { logRequest, newRequestId, SECURITY_HEADERS } from "../lib/log.js";
import { hasVerifiedTotpFactor, listFactors, unenrollTotp } from "../lib/mfa.js";
import { enrollTotp, challengeTotp } from "../lib/mfa.js";
import { mayPerformSensitiveAction, readAalFromVerifiedToken } from "../lib/mfa.js";
import {
  changePassword,
  deleteAccountServerOnly,
  googleStartUrl,
  refreshSession,
  requestPasswordReset,
  signIn,
  signOut,
  signUp,
  verifyMfaWithSession,
  type GoTrueFetch,
} from "../services/authService.js";

export interface AuthDeps {
  /** Injected for tests; production uses GoTrue via fetch. */
  fetchImpl?: GoTrueFetch;
  /** Injected for tests; production uses verifySession. */
  verify?: (token: string, config: AuthConfig) => Promise<AuthUser | null>;
  /** Injected for tests; production uses env. */
  config?: AuthConfig;
  /** Rate-limit hook (Layer 11 owns the store); no-op by default. */
  rateLimit?: (routePattern: string) => Promise<void>;
  appOrigin?: string;
}

export interface AuthResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function json(
  statusCode: number,
  data: unknown,
  extra: Record<string, string> = {},
): AuthResult {
  return {
    statusCode,
    headers: { ...SECURITY_HEADERS, ...extra },
    body: JSON.stringify({ data }),
  };
}

function empty(statusCode: number, extra: Record<string, string> = {}): AuthResult {
  return { statusCode, headers: { ...SECURITY_HEADERS, ...extra }, body: "" };
}

function fail(error: ApiError, extra: Record<string, string> = {}): AuthResult {
  return {
    statusCode: error.status,
    headers: { ...SECURITY_HEADERS, ...extra },
    body: errorBody(error),
  };
}

function splitPath(pathname: string): string[] {
  return (pathname.split("?")[0] ?? "").split("/").filter((s) => s !== "");
}

/** Pattern-only route table: no ids, no auth, no config, no store. */
function authRouteExists(method: string, rest: string[]): boolean {
  // rest[0] is "auth" (enforced by the caller in app.ts).
  if (rest[0] !== "auth") return false;
  const tail = rest.slice(1);
  if (tail.length === 1) {
    if (tail[0] === "signup" && method === "POST") return true;
    if (tail[0] === "signin" && method === "POST") return true;
    if (tail[0] === "signout" && method === "POST") return true;
    if (tail[0] === "reset" && method === "POST") return true;
    if (tail[0] === "refresh" && method === "POST") return true;
    if (tail[0] === "session" && method === "GET") return true;
    if (tail[0] === "google" && method === "GET") return true;
    if (tail[0] === "password" && method === "PATCH") return true;
    if (tail[0] === "account" && method === "DELETE") return true;
  }
  if (tail.length === 2 && tail[0] === "mfa") {
    if (tail[1] === "enroll" && method === "POST") return true;
    if (tail[1] === "challenge" && method === "POST") return true;
    if (tail[1] === "verify" && method === "POST") return true;
    if (tail[1] === "factors" && method === "GET") return true;
  }
  if (
    tail.length === 3 &&
    tail[0] === "mfa" &&
    tail[1] === "factors" &&
    method === "DELETE"
  )
    return true;
  return false;
}

function authRoutePattern(rest: string[]): string {
  const tail = rest.slice(1);
  if (tail.length === 3 && tail[0] === "mfa" && tail[1] === "factors") {
    return "/api/auth/mfa/factors/:id";
  }
  return `/api/auth/${tail.join("/")}`;
}

function resolveConfig(deps: AuthDeps): AuthConfig {
  if (deps.config !== undefined) {
    return deps.config;
  }
  try {
    return getAuthConfig({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    });
  } catch {
    // The missing variable's NAME stays server-side (Layer 5 rule).
    throw unavailable();
  }
}

async function resolveSession(
  deps: AuthDeps,
  config: AuthConfig,
  authorization: string | null | undefined,
): Promise<{ user: AuthUser; token: string }> {
  const token = extractBearerToken(authorization);
  if (token === null) {
    throw unauthenticated();
  }
  let user: AuthUser | null;
  try {
    if (deps.verify !== undefined) {
      user = await deps.verify(token, config);
    } else {
      user = await verifySession(
        token,
        config,
        deps.fetchImpl as unknown as Parameters<typeof verifySession>[2],
      );
    }
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      throw unavailable();
    }
    throw error;
  }
  if (user === null) {
    throw unauthenticated();
  }
  return { user, token };
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value === "") {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a string`);
  }
  return value;
}

export async function handleAuth(
  method: string,
  pathname: string,
  headers: { authorization?: string | null; origin?: string | null },
  bodyText: string | null,
  deps: AuthDeps = {},
): Promise<AuthResult> {
  const requestId = newRequestId();
  const segments = splitPath(pathname);
  const rest = segments.slice(1); // segments[0] is "api"
  const cors = corsHeaders(headers.origin ?? null, deps.appOrigin);
  if (cors === null) {
    logRequest({ requestId, route: "/api/auth/*", method, status: 403, userId: null });
    return fail(forbidden());
  }
  const pattern = authRoutePattern(rest);
  try {
    if (!authRouteExists(method, rest)) {
      throw new ApiError(404, "NOT_FOUND", "Not found");
    }
    const config = resolveConfig(deps);
    const fetchImpl: GoTrueFetch = deps.fetchImpl ?? (fetch as unknown as GoTrueFetch);
    const limit = async (routePattern: string): Promise<void> => {
      if (deps.rateLimit !== undefined) {
        await deps.rateLimit(routePattern);
      }
    };
    const body = (): Record<string, unknown> => parseJsonBody(bodyText);
    const wrap = (
      result: AuthResult,
      userId: string | null,
    ): { result: AuthResult; userId: string | null } => ({ result, userId });

    const tail = rest.slice(1);
    let outcome: { result: AuthResult; userId: string | null };

    if (tail[0] === "signup" && method === "POST") {
      await limit(pattern);
      const signupBody = body();
      assertAllowedKeys(signupBody, ["email", "password"]);
      const result = await signUp(
        config,
        signupBody.email,
        signupBody.password,
        fetchImpl,
      );
      outcome = wrap(json(200, result), result.user.id);
    } else if (tail[0] === "signin" && method === "POST") {
      await limit(pattern);
      const signinBody = body();
      assertAllowedKeys(signinBody, ["email", "password"]);
      const result = await signIn(
        config,
        signinBody.email,
        signinBody.password,
        fetchImpl,
      );
      outcome = wrap(json(200, result), result.user.id);
    } else if (tail[0] === "signout" && method === "POST") {
      const session = await resolveSession(deps, config, headers.authorization);
      await signOut(config, session.token, fetchImpl);
      outcome = wrap(json(200, { signedOut: true }), session.user.id);
    } else if (tail[0] === "reset" && method === "POST") {
      await limit(pattern);
      const resetBody = body();
      assertAllowedKeys(resetBody, ["email"]);
      const result = await requestPasswordReset(config, resetBody.email, fetchImpl);
      outcome = wrap(json(200, result), null);
    } else if (tail[0] === "refresh" && method === "POST") {
      await limit(pattern);
      const refreshBody = body();
      assertAllowedKeys(refreshBody, ["refresh_token"]);
      const result = await refreshSession(config, refreshBody.refresh_token, fetchImpl);
      outcome = wrap(json(200, result), result.user.id);
    } else if (tail[0] === "session" && method === "GET") {
      const session = await resolveSession(deps, config, headers.authorization);
      const aal = readAalFromVerifiedToken(session.token).aal;
      outcome = wrap(json(200, { user: session.user, aal }), session.user.id);
    } else if (tail[0] === "google" && method === "GET") {
      await limit(pattern);
      outcome = wrap(json(200, { url: googleStartUrl(config) }), null);
    } else if (tail[0] === "mfa" && tail[1] === "enroll" && method === "POST") {
      const session = await resolveSession(deps, config, headers.authorization);
      const enrollBody = body();
      assertAllowedKeys(enrollBody, ["friendly_name"]);
      const friendlyName =
        enrollBody.friendly_name === undefined
          ? "Opiinio authenticator"
          : requireString(enrollBody, "friendly_name");
      const enrollment = await enrollTotp(config, session.token, friendlyName, fetchImpl);
      if (enrollment === null) {
        throw new ApiError(400, "VALIDATION_ERROR", "Could not start enrollment");
      }
      // Secret + QR are returned ONCE, to the enrolling user only.
      // The frontend must discard them after verification.
      outcome = wrap(json(201, enrollment), session.user.id);
    } else if (tail[0] === "mfa" && tail[1] === "challenge" && method === "POST") {
      await limit(pattern);
      const session = await resolveSession(deps, config, headers.authorization);
      const challengeBody = body();
      assertAllowedKeys(challengeBody, ["factor_id"]);
      const challengeId = await challengeTotp(
        config,
        session.token,
        requireString(challengeBody, "factor_id"),
        fetchImpl,
      );
      if (challengeId === null) {
        throw new ApiError(400, "VALIDATION_ERROR", "Could not start challenge");
      }
      outcome = wrap(json(200, { challengeId }), session.user.id);
    } else if (tail[0] === "mfa" && tail[1] === "verify" && method === "POST") {
      await limit(pattern);
      const session = await resolveSession(deps, config, headers.authorization);
      const verifyBody = body();
      assertAllowedKeys(verifyBody, ["factor_id", "challenge_id", "code"]);
      const result = await verifyMfaWithSession(
        config,
        session.token,
        requireString(verifyBody, "factor_id"),
        requireString(verifyBody, "challenge_id"),
        verifyBody.code,
        fetchImpl,
      );
      outcome = wrap(json(200, result), session.user.id);
    } else if (tail[0] === "mfa" && tail[1] === "factors" && method === "GET") {
      const session = await resolveSession(deps, config, headers.authorization);
      const factors = await listFactors(config, session.token, fetchImpl);
      // Own factors only, no secrets: listFactors returns id /
      // friendly name / type / status, never a secret or code.
      outcome = wrap(json(200, { items: factors }), session.user.id);
    } else if (
      tail[0] === "mfa" &&
      tail[1] === "factors" &&
      tail.length === 3 &&
      method === "DELETE"
    ) {
      await limit(pattern);
      const session = await resolveSession(deps, config, headers.authorization);
      const factorId = tail[2] as string;
      const factors = await listFactors(config, session.token, fetchImpl);
      const hasFactor = hasVerifiedTotpFactor(factors);
      const aal = readAalFromVerifiedToken(session.token).aal;
      if (!mayPerformSensitiveAction(session.user.id, "unenroll_mfa", aal, hasFactor)) {
        throw forbidden();
      }
      const removed = await unenrollTotp(config, session.token, factorId, fetchImpl);
      if (!removed) {
        throw new ApiError(400, "VALIDATION_ERROR", "Could not remove factor");
      }
      outcome = wrap(empty(204), session.user.id);
    } else if (tail[0] === "password" && method === "PATCH") {
      await limit(pattern);
      const session = await resolveSession(deps, config, headers.authorization);
      const factors = await listFactors(config, session.token, fetchImpl);
      const hasFactor = hasVerifiedTotpFactor(factors);
      const aal = readAalFromVerifiedToken(session.token).aal;
      if (
        !mayPerformSensitiveAction(session.user.id, "change_password", aal, hasFactor)
      ) {
        throw forbidden();
      }
      const passwordBody = body();
      assertAllowedKeys(passwordBody, ["password"]);
      const result = await changePassword(
        config,
        session.token,
        passwordBody.password,
        fetchImpl,
      );
      outcome = wrap(json(200, result), session.user.id);
    } else if (tail[0] === "account" && method === "DELETE") {
      await limit(pattern);
      const session = await resolveSession(deps, config, headers.authorization);
      const factors = await listFactors(config, session.token, fetchImpl);
      const hasFactor = hasVerifiedTotpFactor(factors);
      const aal = readAalFromVerifiedToken(session.token).aal;
      if (!mayPerformSensitiveAction(session.user.id, "delete_account", aal, hasFactor)) {
        throw forbidden();
      }
      // Gate passed; the actual GoTrue deletion is server-only
      // (admin API + service_role key, never wired here).
      deleteAccountServerOnly();
      // Unreachable by construction (deleteAccountServerOnly throws).
      outcome = wrap(empty(204), session.user.id);
    } else {
      throw new ApiError(404, "NOT_FOUND", "Not found");
    }

    logRequest({
      requestId,
      route: pattern,
      method,
      status: outcome.result.statusCode,
      userId: outcome.userId,
    });
    return { ...outcome.result, headers: { ...outcome.result.headers, ...cors } };
  } catch (error) {
    // GoTrue unreachable is a service problem, not a client
    // error: map it to the generic 503 here (the api.ts route
    // does the same in resolveCaller; auth service calls bypass
    // that path, so this catch must do it). toApiError alone
    // would turn it into a misleading 500.
    const apiError =
      error instanceof AuthUnavailableError ? unavailable() : toApiError(error);
    logRequest({
      requestId,
      route: pattern,
      method,
      status: apiError.status,
      userId: null,
    });
    return fail(apiError, cors);
  }
}
