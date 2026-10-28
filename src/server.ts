/**
 * Entry point. Validates env, starts the HTTP server, and shuts
 * down gracefully so in-flight requests finish during deploys.
 * No business logic lives here.
 */

import { createServer } from "node:http";
import { route } from "./app.js";
import { loadEnv } from "./lib/env.js";

const env = loadEnv();

async function handleRequest(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${env.port}`);
    const result = await route(req.method ?? "GET", url.pathname, env);
    res.writeHead(result.statusCode, {
      "content-type": result.contentType,
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
