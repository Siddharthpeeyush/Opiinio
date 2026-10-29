/**
 * Server auth service — the ONLY place that talks to GoTrue for
 * sign-up / sign-in / reset / refresh / password change / MFA
 * verification with a session return.
 *
 * Proven provider only (Supabase Auth / GoTrue), zero new runtime
 * dependencies, global fetch only — see
 * docs/decisions/0011-server-auth-routes.md for why
 * @supabase/supabase-js was rejected for this server layer.
 *
 * PRIVACY RULES (Layer 5 + this layer, enforced here):
 * - This module runs on the SERVER only. The frontend must never
 *   call GoTrue, PostgREST, or any Supabase host directly — it
 *   calls /api/auth/* and this module proxies to GoTrue.
 * - Tokens, passwords, OTP/MFA codes, and emails are NEVER
 *   logged, and GoTrue raw errors are NEVER returned to the
 *   client. Failures map to the single generic error shape:
 *   bad credentials -> 401 "Invalid email or password" (never
 *   "no such email" vs "wrong password" — that would be an
 *   email-existence oracle); signup failures -> generic 400;
 *   password-reset -> always { sent: true } on a reachable
 *   GoTrue, even for an unknown email (same oracle rule);
 *   network failure -> AuthUnavailableError (routes map it to
 *   generic 503, never a variable name).
 * - The ONLY personal datum returned is the SIGNED-IN user's
 *   own id/email, for their own account screen. No other user's
 *   email, no token material beyond the caller's own session,
 *   no MFA secret except the one-time enrollment secret shown
 *   to the enrolling user (and only once, by the frontend).
 * - SMS / phone MFA is EXPLICITLY EXCLUDED (paid add-on, breaks
 *   the ₹0 rule). Nothing here creates a phone factor.
 * - NO BACKUP CODES are invented (Supabase MFA has none).
 * - Account deletion: GoTrue user deletion needs the admin API
 *   with the service_role key, which must NEVER be wired into
 *   this repo. deleteAccountServerOnly() therefore throws a
 *   SERVER_ONLY error AFTER the aal gate has passed — the route
 *   proves the gate, then stops honestly at the server-only
 *   boundary instead of pretending a deletion happened.
 */

import type { AuthConfig } from "../lib/auth.js";
import { AuthUnavailableError } from "../lib/auth.js";
import { ApiError, badRequest, unauthenticated, unavailable } from "../lib/http.js";

export type GoTrueFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface GoTrueSession {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  expiresIn: number | null;
  user: { id: string; email: string | null };
}

export interface AuthSessionResult {
  user: { id: string; email: string | null };
  session: GoTrueSession | null;
}

function baseUrl(config: AuthConfig): string {
  return config.supabaseUrl.replace(/\/+$/, "");
}

function headers(config: AuthConfig, token?: string): Record<string, string> {
  const result: Record<string, string> = {
    apikey: config.anonKey,
    "Content-Type": "application/json",
  };
  if (token !== undefined && token !== "") {
    result.Authorization = `Bearer ${token}`;
  }
  return result;
}

interface GoTrueResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

async function goTrueCall(
  config: AuthConfig,
  path: string,
  init: { method: string; token?: string; body?: Record<string, unknown> },
  fetchImpl: GoTrueFetch,
): Promise<GoTrueResponse> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(`${baseUrl(config)}${path}`, {
      method: init.method,
      headers: headers(config, init.token),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AuthUnavailableError();
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function parseUser(body: unknown): { id: string; email: string | null } | null {
  const parsed = body as { id?: unknown; email?: unknown } | null;
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const id = asString(parsed.id);
  if (id === null) {
    return null;
  }
  return {
    id,
    email: typeof parsed.email === "string" ? parsed.email : null,
  };
}

/**
 * GoTrue session shapes vary by endpoint: most return the session
 * at the top level ({ access_token, user }), signup may nest it
 * under `session`, and MFA verify may return a session or just a
 * verification result. Parse defensively; a body without an
 * access token is "no session", never a fabricated one.
 */
function parseSession(body: unknown): GoTrueSession | null {
  const parsed = body as {
    access_token?: unknown;
    refresh_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
    user?: unknown;
    session?: unknown;
  } | null;
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const sessionBody =
    parsed.session !== null && typeof parsed.session === "object"
      ? (parsed.session as Record<string, unknown>)
      : (parsed as Record<string, unknown>);
  const accessToken = asString(sessionBody.access_token);
  const user = parseUser(sessionBody.user);
  if (accessToken === null || user === null) {
    return null;
  }
  return {
    accessToken,
    refreshToken: asString(sessionBody.refresh_token),
    tokenType:
      typeof sessionBody.token_type === "string" ? sessionBody.token_type : "bearer",
    expiresIn: typeof sessionBody.expires_in === "number" ? sessionBody.expires_in : null,
    user,
  };
}

export function validateEmail(value: unknown): string {
  if (typeof value !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())) {
    throw badRequest("Enter a valid email address");
  }
  return value.trim();
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw badRequest("Password must be 8–128 characters");
  }
  return value;
}

function genericSignupFailure(): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", "Could not create account");
}

function genericSigninFailure(): ApiError {
  return new ApiError(401, "UNAUTHENTICATED", "Invalid email or password");
}

/** Email sign-up. Returns a session only when GoTrue issues one. */
export async function signUp(
  config: AuthConfig,
  email: unknown,
  password: unknown,
  fetchImpl: GoTrueFetch = fetch as unknown as GoTrueFetch,
): Promise<{
  user: { id: string; email: string | null };
  session: GoTrueSession | null;
  emailConfirmationRequired: boolean;
}> {
  const cleanEmail = validateEmail(email);
  const cleanPassword = validatePassword(password);
  const response = await goTrueCall(
    config,
    "/auth/v1/signup",
    { method: "POST", body: { email: cleanEmail, password: cleanPassword } },
    fetchImpl,
  );
  if (!response.ok) {
    throw genericSignupFailure();
  }
  const session = parseSession(response.body);
  const user = session?.user ?? parseUser(response.body);
  if (user === null) {
    throw genericSignupFailure();
  }
  return { user, session, emailConfirmationRequired: session === null };
}

/** Email sign-in. Bad credentials are one generic 401, never an oracle. */
export async function signIn(
  config: AuthConfig,
  email: unknown,
  password: unknown,
  fetchImpl: GoTrueFetch = fetch as unknown as GoTrueFetch,
): Promise<AuthSessionResult> {
  const cleanEmail = validateEmail(email);
  const cleanPassword = validatePassword(password);
  const response = await goTrueCall(
    config,
    "/auth/v1/token?grant_type=password",
    { method: "POST", body: { email: cleanEmail, password: cleanPassword } },
    fetchImpl,
  );
  if (!response.ok) {
    throw genericSigninFailure();
  }
  const session = parseSession(response.body);
  if (session === null) {
    throw genericSigninFailure();
  }
  return { user: session.user, session };
}

/**
 * Sign-out: best-effort GoTrue revocation. A rejected token is
 * already dead, so the caller still signs out locally — only a
 * network failure (AuthUnavailableError) is a real failure.
 */
export async function signOut(
  config: AuthConfig,
  token: string,
  fetchImpl: GoTrueFetch = fetch as unknown as GoTrueFetch,
): Promise<boolean> {
  await goTrueCall(
    config,
    "/auth/v1/logout",
    { method: "POST", token, body: {} },
    fetchImpl,
  );
  return true;
}

/**
 * Password-reset request. ALWAYS { sent: true } when GoTrue is
 * reachable, even for an unknown email — returning a different
 * answer for unknown emails would leak which emails have
 * accounts. Only validation and network failure differ.
 */
export async function requestPasswordReset(
  config: AuthConfig,
  email: unknown,
  fetchImpl: GoTrueFetch = fetch as unknown as GoTrueFetch,
): Promise<{ sent: true }> {
  const cleanEmail = validateEmail(email);
  await goTrueCall(
    config,
    "/auth/v1/recover",
    { method: "POST", body: { email: cleanEmail } },
    fetchImpl,
  );
  return { sent: true };
}

/** Refresh a session with a refresh token. Expired -> generic 401. */
export async function refreshSession(
  config: AuthConfig,
  refreshToken: unknown,
  fetchImpl: GoTrueFetch = fetch as unknown as GoTrueFetch,
): Promise<AuthSessionResult> {
  if (typeof refreshToken !== "string" || refreshToken.trim() === "") {
    throw unauthenticated();
  }
  const response = await goTrueCall(
    config,
    "/auth/v1/token?grant_type=refresh_token",
    { method: "POST", body: { refresh_token: refreshToken.trim() } },
    fetchImpl,
  );
  if (!response.ok) {
    throw new ApiError(401, "UNAUTHENTICATED", "Session expired, sign in again");
  }
  const session = parseSession(response.body);
  if (session === null) {
    throw new ApiError(401, "UNAUTHENTICATED", "Session expired, sign in again");
  }
  return { user: session.user, session };
}

/** Self-service password change (GoTrue, Bearer token — no admin key). */
export async function changePassword(
  config: AuthConfig,
  token: string,
  password: unknown,
  fetchImpl: GoTrueFetch = fetch as unknown as GoTrueFetch,
): Promise<{ changed: true }> {
  const cleanPassword = validatePassword(password);
  const response = await goTrueCall(
    config,
    "/auth/v1/user",
    { method: "PUT", token, body: { password: cleanPassword } },
    fetchImpl,
  );
  if (!response.ok) {
    throw new ApiError(400, "VALIDATION_ERROR", "Could not change password");
  }
  return { changed: true };
}

/**
 * Google OAuth start URL.
 *
 * This is GoTrue's authorize endpoint for this project — it is
 * NOT a callback invented here. The Google OAuth client's
 * registered redirect URI (the Supabase callback) is
 * https://moahibzipoyyheaceonp.supabase.co/auth/v1/callback for
 * the real project (AUTH-SETUP-GUIDE.md Step 2); that URI lives
 * in Google Cloud + the Supabase dashboard, never as a query
 * parameter invented by this code. No redirect_to is added:
 * after Google + Supabase finish, Supabase redirects to the
 * Site URL configured in the dashboard (Step 3), which is the
 * app origin. Google client creation + provider enablement
 * remain the user's dashboard steps.
 */
export function googleStartUrl(config: AuthConfig): string {
  return `${baseUrl(config)}/auth/v1/authorize?provider=google`;
}

/**
 * MFA verify that also returns the upgraded (aal2) session when
 * GoTrue issues one. The code format is validated locally first
 * (no network call for a malformed code). A wrong code is a
 * generic 400 — the caller is already authenticated, so this
 * leaks nothing about other accounts.
 */
export async function verifyMfaWithSession(
  config: AuthConfig,
  token: string,
  factorId: string,
  challengeId: string,
  code: unknown,
  fetchImpl: GoTrueFetch = fetch as unknown as GoTrueFetch,
): Promise<{ verified: boolean; session: GoTrueSession | null }> {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    throw badRequest("Code must be exactly 6 digits");
  }
  if (factorId === "" || challengeId === "") {
    return { verified: false, session: null };
  }
  const response = await goTrueCall(
    config,
    `/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
    { method: "POST", token, body: { challenge_id: challengeId, code } },
    fetchImpl,
  );
  if (!response.ok) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid code");
  }
  return { verified: true, session: parseSession(response.body) };
}

/**
 * SERVER-ONLY BOUNDARY — see the header. The route gates this
 * with mayPerformSensitiveAction() FIRST (aal2 when enrolled),
 * then calls this, which stops honestly: GoTrue user deletion
 * needs the admin API + service_role key, and that key must
 * never be wired into this repo. A future admin layer (dashboard
 * unenroll/delete, or a server-only function holding the key
 * outside this codebase) owns the actual deletion.
 */
export function deleteAccountServerOnly(): never {
  throw new ApiError(
    403,
    "SERVER_ONLY",
    "Account deletion needs an admin step and is not completed by this route",
  );
}

/** Re-exported for routes: missing env -> generic 503, never a name. */
export function configUnavailable(): ApiError {
  return unavailable();
}
