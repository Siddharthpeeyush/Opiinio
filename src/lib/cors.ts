/**
 * Layer 5 — CORS, same-origin / explicitly configured origin only.
 *
 * NEVER "*": a wildcard origin with a Bearer token scheme would
 * let any site read API responses in the victim's browser context
 * (and the task's privacy rule forbids it outright). Auth here is
 * Bearer tokens, not cookies, so no Access-Control-Allow-Credentials
 * header is ever set — there is no cookie credential to share.
 *
 * Allowed origin comes from APP_ORIGIN (documented name only in
 * .env.example); default is the local dev origin. A request with
 * no Origin header (curl, server-to-server, same-origin fetch
 * without Origin) is not a CORS request and is allowed through —
 * CORS is a browser policy, not the auth layer; auth still runs.
 */

export const DEFAULT_ORIGIN = "http://localhost:3000";

export function allowedOrigin(appOrigin: string | undefined): string {
  const origin = (appOrigin ?? "").trim();
  return origin === "" ? DEFAULT_ORIGIN : origin;
}

/**
 * Returns the CORS headers to set, or null when the Origin must be
 * refused. Callers map a null result to a generic 403.
 */
export function corsHeaders(
  origin: string | null | undefined,
  appOrigin: string | undefined,
): Record<string, string> | null {
  if (origin === null || origin === undefined || origin === "") {
    return {};
  }
  if (origin !== allowedOrigin(appOrigin)) {
    return null;
  }
  return {
    "access-control-allow-origin": origin,
    vary: "Origin",
  };
}
