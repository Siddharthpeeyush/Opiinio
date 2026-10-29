/**
 * Netlify Functions adapter tests (decision 0020).
 *
 * These test the adapter's own responsibilities — event → route() mapping,
 * non-API gating, env-refusal, and base64 body decoding — through the real
 * route(), never a mocked copy of it.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../src/functions/api.js";

const TOUCHED = ["APP_ENV", "SUPABASE_URL", "SUPABASE_ANON_KEY", "APP_ORIGIN"] as const;

const saved: Record<string, string | undefined> = {};
for (const key of TOUCHED) saved[key] = process.env[key];

after(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function previewEnv(): void {
  process.env["APP_ENV"] = "development";
  delete process.env["SUPABASE_URL"];
  delete process.env["SUPABASE_ANON_KEY"];
  delete process.env["APP_ORIGIN"];
}

describe("netlify function adapter", () => {
  it("maps a Netlify event to route() and back (GET /api/health)", async () => {
    previewEnv();
    const res = await handler({
      httpMethod: "GET",
      path: "/api/health",
      headers: {},
      body: null,
      isBase64Encoded: false,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/json");
    const parsed = JSON.parse(res.body) as { status: string };
    assert.equal(parsed.status, "ok");
  });

  it("answers non-API paths with the generic 404 (defense in depth)", async () => {
    previewEnv();
    const res = await handler({
      httpMethod: "GET",
      path: "/index.html",
      headers: {},
      body: null,
      isBase64Encoded: false,
    });
    assert.equal(res.statusCode, 404);
    const parsed = JSON.parse(res.body) as {
      error: { code: string; message: string };
    };
    assert.equal(parsed.error.code, "NOT_FOUND");
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("returns a generic 503 that names no variable when env is refused", async () => {
    // loadEnv refuses to boot on APP_ENV=production with missing
    // required vars; the adapter must answer generic 503.
    process.env["APP_ENV"] = "production";
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_ANON_KEY"];
    delete process.env["APP_ORIGIN"];
    const res = await handler({
      httpMethod: "GET",
      path: "/api/health",
      headers: {},
      body: null,
      isBase64Encoded: false,
    });
    assert.equal(res.statusCode, 503);
    const parsed = JSON.parse(res.body) as {
      error: { code: string; message: string };
    };
    assert.equal(parsed.error.code, "SERVICE_UNAVAILABLE");
    assert.ok(
      !res.body.includes("SUPABASE_URL"),
      "the missing variable's name must stay server-side",
    );
  });

  it("decodes base64 bodies before route() sees them", async () => {
    // Dummy Supabase values get past resolveConfig so the request reaches
    // body parsing; the unreachable 127.0.0.1:9 makes the later GoTrue
    // call fail fast with a generic 5xx — which is exactly the point:
    // valid JSON must NOT come back as "must be valid JSON".
    process.env["APP_ENV"] = "development";
    process.env["SUPABASE_URL"] = "http://127.0.0.1:9/";
    process.env["SUPABASE_ANON_KEY"] = "dummy-test-key";
    const payload = Buffer.from(
      JSON.stringify({
        email: "adapter-a@example.com",
        password: "testpass123",
      }),
      "utf8",
    ).toString("base64");

    const decoded = await handler({
      httpMethod: "POST",
      path: "/api/auth/signup",
      headers: {},
      body: payload,
      isBase64Encoded: true,
    });
    assert.ok(
      !decoded.body.includes("must be valid JSON"),
      "base64 body must be decoded before JSON parsing",
    );
    assert.notEqual(decoded.statusCode, 400);

    // Control: the same text WITHOUT the base64 flag is not valid JSON,
    // so route() must answer 400 "must be valid JSON".
    const raw = await handler({
      httpMethod: "POST",
      path: "/api/auth/signup",
      headers: {},
      body: payload,
      isBase64Encoded: false,
    });
    assert.equal(raw.statusCode, 400);
    assert.ok(raw.body.includes("must be valid JSON"));
  });
});
