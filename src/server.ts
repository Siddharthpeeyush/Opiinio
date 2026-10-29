/**
 * Entry point. Validates env, starts the HTTP server, and shuts
 * down gracefully so in-flight requests finish during deploys.
 * No business logic lives here.
 */

import { createServer } from "node:http";
import { route } from "./app.js";
import { loadEnv } from "./lib/env.js";
import { createDefaultRateLimiter } from "./lib/rateLimit.js";

const env = loadEnv();
// Layer 11: one shared in-memory limiter for this process.
// Multi-instance deploys need the shared-store follow-up in
// decision 0013; a single instance is the V1 launch shape.
const rateLimiter = createDefaultRateLimiter();

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > 1_048_576) {
      // Hard memory cap: stop reading a pathological body. The API
      // layer's own 64 KB limit still returns 413 for bodies
      // between 64 KB and this cap; above it the body is dropped
      // and the API layer reports a generic 400 instead.
      return "";
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleRequest(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${env.port}`);
    const method = req.method ?? "GET";
    const needsBody = method === "POST" || method === "PATCH" || method === "PUT";
    const bodyText = needsBody ? await readBody(req) : null;
    const result = await route(method, url.pathname, env, {
      headers: {
        authorization: req.headers.authorization ?? null,
        origin: req.headers.origin ?? null,
      },
      bodyText,
      rateLimiter,
      // Direct socket address only — X-Forwarded-For is spoofable
      // and is never trusted here (see decision 0013).
      clientIp: req.socket.remoteAddress ?? null,
    });
    // Security headers on every response; API routes add their own
    // (CORS, no-store) on top. Node never sets X-Powered-By here.
    res.writeHead(result.statusCode, {
      "content-type": result.contentType,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      ...result.headers,
    });
    res.end(result.body);
  } catch {
    // Never leak internal detail to the client.
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "Internal error" },
      }),
    );
  }
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(env.port, () => {
  console.log(`Opiinio scaffold listening on http://localhost:${env.port}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    process.exit(0);
  });
  // Force exit if in-flight requests hang beyond 10s.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
