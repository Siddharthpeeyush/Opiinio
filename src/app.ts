/**
 * Route table. Keeps src/server.ts small: this module decides which
 * handler answers which path, and nothing else.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnvConfig } from "./lib/env.js";
import { handleHealth, handleLive } from "./routes/health.js";

export interface RouteResult {
  statusCode: number;
  contentType: string;
  body: string;
}

// The server always runs from dist/ (see package.json scripts), so
// src/app.ts compiles to dist/src/app.js and the public dir is two
// levels up from there. Do not "fix" this to one level up: that was
// the bug that made GET / fail in tests (it pointed at dist/public).
const PUBLIC_DIR = join(import.meta.dirname, "..", "..", "public");

export async function route(
  method: string,
  pathname: string,
  env: EnvConfig,
): Promise<RouteResult> {
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
  return {
    statusCode: 404,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }),
  };
}
