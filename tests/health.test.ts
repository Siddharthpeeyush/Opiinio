import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { route } from "../src/app.js";
import { loadEnv } from "../src/lib/env.js";

/**
 * Scaffold tests only: prove the dev server answers the health
 * endpoints and the landing page, and that unknown paths 404.
 * No database, auth, or feature is tested here — those do not
 * exist yet, and no test for them is faked.
 */

function startTestServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  // The OS picks an ephemeral port (listen(0)); loadEnv is only used
  // for the fixed PORT value passed into route(), which is 3001 here
  // and is not the port the test server actually listens on.
  return new Promise((resolve, reject) => {
    const testEnv = loadEnv({ ...process.env, PORT: "3001" });
    const server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const result = await route(req.method ?? "GET", url.pathname, testEnv);
        res.writeHead(result.statusCode, {
          "content-type": result.contentType,
        });
        res.end(result.body);
      })();
    });
    server.on("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not determine test server port"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((resolveClose) => {
            // fetch() keeps connections alive by default; without
            // this, server.close() waits forever and the test run
            // hangs after the last assertion.
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

describe("health endpoints", () => {
  it("GET /api/health returns 200 with status ok", async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        status: string;
        scope: string;
      };
      assert.equal(body.status, "ok");
      assert.equal(body.scope, "app");
    } finally {
      await close();
    }
  });

  it("GET /api/health/live returns 200 with status ok", async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/health/live`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { status: string };
      assert.equal(body.status, "ok");
    } finally {
      await close();
    }
  });

  it("GET / returns the React app shell", async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await fetch(`http://localhost:${port}/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /Opiinio/);
      assert.match(text, /every opinion matters/i);
    } finally {
      await close();
    }
  });

  it("unknown paths return 404 with the standard error shape", async () => {
    const { port, close } = await startTestServer();
    try {
      const res = await fetch(`http://localhost:${port}/nope`);
      assert.equal(res.status, 404);
      const body = (await res.json()) as {
        error: { code: string };
      };
      assert.equal(body.error.code, "NOT_FOUND");
    } finally {
      await close();
    }
  });
});

describe("env validation", () => {
  it("rejects an invalid PORT", () => {
    assert.throws(() => loadEnv({ PORT: "not-a-port" }), /Invalid PORT/);
  });

  it("defaults to port 3000 when PORT is unset", () => {
    const env = loadEnv({ NODE_ENV: "test" });
    assert.equal(env.port, 3000);
  });
});
