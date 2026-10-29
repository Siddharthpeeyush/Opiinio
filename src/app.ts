/**
 * Route table. Keeps src/server.ts small: this module decides which
 * handler answers which path, and nothing else.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvConfig } from "./lib/env.js";
import { handleHealth, handleLive } from "./routes/health.js";
import { handleApi, type ApiDeps } from "./routes/api.js";
import { handleAuth, type AuthDeps } from "./routes/auth.js";
import { SECURITY_HEADERS } from "./lib/log.js";
import {
  createDefaultRateLimiter,
  hashKeyPart,
  isAuthStrictRoute,
  type RateLimiter,
} from "./lib/rateLimit.js";

export interface RouteResult {
  statusCode: number;
  contentType: string;
  body: string;
  headers?: Record<string, string>;
}

export interface RouteOptions {
  headers?: { authorization?: string | null; origin?: string | null };
  bodyText?: string | null;
  apiDeps?: ApiDeps;
  authDeps?: AuthDeps;
  /** Shared Layer 11 limiter; server.ts supplies one, tests may inject. */
  rateLimiter?: RateLimiter;
  /** Direct socket address from server.ts; hashed before keying. */
  clientIp?: string | null;
}

// The server always runs from dist/ (see package.json scripts), so
// src/app.ts compiles to dist/src/app.js and the public dir is two
// levels up from there. Do not "fix" this to one level up: that was
// the bug that made GET / fail in tests (it pointed at dist/public).
const PUBLIC_DIR = join(import.meta.dirname, "..", "..", "public");

// Layer 11: one shared in-memory limiter for the deployed server.
// route() is the only path server.ts uses, so this is where the
// default no-op hook is replaced by real enforcement. Direct
// handleAuth / handleApi calls without injected deps stay
// un-limited (test isolation); that is documented, not hidden.
let sharedRateLimiter: RateLimiter | null = null;

function defaultRateLimiter(): RateLimiter {
  if (sharedRateLimiter === null) {
    sharedRateLimiter = createDefaultRateLimiter();
  }
  return sharedRateLimiter;
}

export async function route(
  method: string,
  pathname: string,
  env: EnvConfig,
  opts: RouteOptions = {},
): Promise<RouteResult> {
  const limiter = opts.rateLimiter ?? defaultRateLimiter();
  const ipKey = `ip:${hashKeyPart(opts.clientIp ?? "unknown")}`;
  // Production auth adapter: the handler supplies a hashed-email
  // or user-id key; strict routes additionally check the IP key,
  // and key-less routes (refresh, Google start) check IP only.
  const authRateLimit =
    opts.authDeps?.rateLimit ??
    (async (pattern: string, key?: string): Promise<void> => {
      const keys: string[] = [];
      if (key !== undefined) {
        keys.push(key);
      }
      if (key === undefined || isAuthStrictRoute(pattern)) {
        keys.push(ipKey);
      }
      await limiter.checkAuthRoute(pattern, keys);
    });
  // Server auth routes (the /api/auth/* layer). Dispatched before
  // the generic API routes
  // so auth has its own route table, CORS, and logging — and so
  // an unknown /api/auth path gets the same generic 404.
  if (pathname.startsWith("/api/auth/")) {
    const result = await handleAuth(
      method,
      pathname,
      {
        authorization: opts.headers?.authorization ?? null,
        origin: opts.headers?.origin ?? null,
      },
      opts.bodyText ?? null,
      {
        ...opts.authDeps,
        rateLimit: authRateLimit,
        appOrigin: opts.authDeps?.appOrigin ?? env.appOrigin,
      },
    );
    return {
      statusCode: result.statusCode,
      contentType: "application/json",
      body: result.body,
      headers: result.headers,
    };
  }
  // Layer 5 API routes (everything under /api/ except health).
  // No /api/docs, no spec endpoint, no listing route exists here.
  if (
    pathname.startsWith("/api/") &&
    pathname !== "/api/health" &&
    pathname !== "/api/health/live"
  ) {
    const result = await handleApi(
      method,
      pathname,
      {
        authorization: opts.headers?.authorization ?? null,
        origin: opts.headers?.origin ?? null,
      },
      opts.bodyText ?? null,
      {
        ...opts.apiDeps,
        rateLimiter: opts.apiDeps?.rateLimiter ?? limiter,
        clientIp: opts.apiDeps?.clientIp ?? opts.clientIp ?? null,
        appOrigin: opts.apiDeps?.appOrigin ?? env.appOrigin,
      },
    );
    return {
      statusCode: result.statusCode,
      contentType: "application/json",
      body: result.body,
      headers: result.headers,
    };
  }
  if (method === "GET" && pathname === "/api/health") {
    const result = handleHealth(env);
    return {
      statusCode: result.statusCode,
      contentType: "application/json",
      body: result.body,
    };
  }
  if (method === "GET" && pathname === "/api/health/live") {
    const result = handleLive();
    return {
      statusCode: result.statusCode,
      contentType: "application/json",
      body: result.body,
    };
  }
  if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
    return { statusCode: 200, contentType: "text/html", body: html };
  }
  if (method === "GET" && pathname === "/styles.css") {
    const css = await readFile(join(PUBLIC_DIR, "styles.css"), "utf8");
    return { statusCode: 200, contentType: "text/css", body: css };
  }
  if (method === "GET" && pathname === "/app.js") {
    // Layer 6 frontend. Same-origin script only; it fetches /api/*
    // and nothing else (see public/app.js header + frontend tests).
    const js = await readFile(join(PUBLIC_DIR, "app.js"), "utf8");
    return { statusCode: 200, contentType: "text/javascript", body: js };
  }
  return {
    statusCode: 404,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }),
    headers: { ...SECURITY_HEADERS },
  };
}
