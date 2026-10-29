/**
 * Netlify Functions adapter for the Opiinio API (decision 0020).
 *
 * Netlify's free tier serves static files; it cannot run the long-lived
 * Node server in src/server.ts. This function is a thin translation layer:
 * Netlify HTTP event -> route() -> Netlify HTTP response. All routing,
 * auth, validation, rate limiting, and privacy rules live in route() and
 * the layers beneath it; NOTHING is reimplemented here.
 *
 * netlify.toml rewrites /api/* to this function (status 200, original URL
 * preserved); the Netlify CDN serves everything else from public/.
 *
 * Compiled by tsc into dist/src/functions/api.js (rootDir "." mirrors
 * the source tree); netlify.toml points the functions directory at
 * dist/src/functions. Zero runtime dependencies —
 * only node: builtins and the app's own modules.
 */

import { route } from "../app.js";
import { loadEnv } from "../lib/env.js";
import { errorBody, notFound, unavailable } from "../lib/http.js";
import { createDefaultRateLimiter } from "../lib/rateLimit.js";

/** The Netlify function event fields this adapter reads. */
interface NetlifyEvent {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface NetlifyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

type Limiter = ReturnType<typeof createDefaultRateLimiter>;

// One limiter per warm function instance. Serverless instances are NOT a
// single process (see decision 0020): strict per-IP buckets hold per
// instance, so a distributed burst is under-counted. Auth-keyed buckets
// (user id / hashed email) are unaffected in practice.
let limiter: Limiter | null = null;

function sharedLimiter(): Limiter {
  if (limiter === null) limiter = createDefaultRateLimiter();
  return limiter;
}

/**
 * Netlify sets x-nf-client-connection-ip from the TCP connection on every
 * function invocation (it overwrites any client-sent value), so unlike
 * X-Forwarded-For it is not client-spoofable. Falls back to null, which
 * route() keys as a shared "unknown" bucket (documented, not hidden).
 */
function clientIp(headers: Record<string, string | undefined>): string | null {
  const direct = headers["x-nf-client-connection-ip"] ?? headers["x-bb-ip"] ?? null;
  return direct !== null && direct.length > 0 ? direct : null;
}

function json(statusCode: number, body: string): NetlifyResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body,
  };
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  const method = (event.httpMethod ?? "GET").toUpperCase();
  const pathname = event.path ?? "/";
  const headers = event.headers ?? {};

  // Defense in depth: netlify.toml only rewrites /api/* here; anything
  // else reaching the function is a misconfiguration, answered generic.
  if (!pathname.startsWith("/api/")) {
    return json(404, errorBody(notFound()));
  }

  let env;
  try {
    env = loadEnv();
  } catch {
    // Mirrors an unconfigured server: the API answers generic 503.
    // The missing variable's NAME is never sent to the client.
    return json(503, errorBody(unavailable()));
  }

  let bodyText: string | null = null;
  if (method === "POST" || method === "PATCH" || method === "PUT") {
    const raw = event.body ?? "";
    bodyText = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
  }

  try {
    const result = await route(method, pathname, env, {
      headers: {
        authorization: headers["authorization"] ?? null,
        origin: headers["origin"] ?? null,
      },
      bodyText,
      rateLimiter: sharedLimiter(),
      clientIp: clientIp(headers),
    });
    return {
      statusCode: result.statusCode,
      headers: {
        "content-type": result.contentType,
        ...(result.headers ?? {}),
      },
      body: result.body,
    };
  } catch {
    // route() maps its own errors to the single error shape; anything
    // escaping it is answered generic so no detail leaks.
    return json(503, errorBody(unavailable()));
  }
}
