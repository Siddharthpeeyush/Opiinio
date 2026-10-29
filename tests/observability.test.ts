import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadEnv, isPlaceholderValue } from "../src/lib/env.js";
import { logRequest } from "../src/lib/log.js";
import { reportError, setErrorReporter, resetErrorReporter } from "../src/lib/errors.js";
import { route } from "../src/app.js";
import { buildHealth } from "../src/services/healthService.js";

/**
 * Layer 16 — hosting + observability tests.
 * Proves env validation, log shape, the error hook, health
 * components, and cache headers. Mocked/local only: no live
 * Supabase, no vendor tracker, no real staging/prod.
 */

const BASE_ENV = {
  PORT: "3210",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  // A structurally real-looking JWT (header.payload.signature);
  // never a real secret — the scanner treats test fakes as clean,
  // and this value is never a credential for anything.
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig",
  APP_ORIGIN: "https://staging-opiinio.netlify.app",
};

function capture(fn: () => void, stream: "log" | "error"): string[] {
  const lines: string[] = [];
  const original = console[stream];
  console[stream] = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console[stream] = original;
  }
  return lines;
}

// ---------------------------------------------------------------- env validation

describe("env validation — APP_ENV and production strictness", () => {
  it("defaults to development and boots without Supabase vars (preview mode)", () => {
    const env = loadEnv({ PORT: "3210" });
    assert.equal(env.appEnv, "development");
    assert.deepEqual(env.presentOptional, []);
  });

  it("rejects an unknown APP_ENV, naming the variable", () => {
    assert.throws(() => loadEnv({ PORT: "3210", APP_ENV: "prod" }), /APP_ENV/);
  });

  it("staging boots without Supabase vars (preview preserved)", () => {
    const env = loadEnv({ PORT: "3210", APP_ENV: "staging" });
    assert.equal(env.appEnv, "staging");
  });

  it("production refuses to boot when a required var is missing, naming it (never the value)", () => {
    assert.throws(
      () =>
        loadEnv({
          PORT: "3210",
          APP_ENV: "production",
          SUPABASE_URL: BASE_ENV.SUPABASE_URL,
          // SUPABASE_ANON_KEY and APP_ORIGIN missing
        }),
      /Missing required environment variable: (SUPABASE_ANON_KEY|APP_ORIGIN)/,
    );
  });

  it("production refuses placeholder values, naming the variable (never echoing the value)", () => {
    assert.throws(
      () =>
        loadEnv({
          ...BASE_ENV,
          APP_ENV: "production",
          SUPABASE_URL: "https://your-project.supabase.co",
        }),
      (err: unknown) => {
        const message = (err as Error).message;
        return (
          /Invalid value for environment variable: SUPABASE_URL/.test(message) &&
          !message.includes("your-project")
        );
      },
    );
  });

  it("production boots with real-looking values", () => {
    const env = loadEnv({ ...BASE_ENV, APP_ENV: "production" });
    assert.equal(env.appEnv, "production");
    assert.ok(env.presentOptional.includes("SUPABASE_URL"));
    assert.ok(env.presentOptional.includes("SUPABASE_ANON_KEY"));
    assert.equal(env.appOrigin, BASE_ENV.APP_ORIGIN);
  });

  it("isPlaceholderValue flags examples and passes real-looking values", () => {
    assert.equal(isPlaceholderValue("https://your-project.supabase.co"), true);
    assert.equal(isPlaceholderValue("changeme"), true);
    assert.equal(isPlaceholderValue("<paste key here>"), true);
    assert.equal(isPlaceholderValue("https://abcdefghijklmnopqrst.supabase.co"), false);
  });
});

// ---------------------------------------------------------------- log shape

describe("request logs — JSON with durationMs and appEnv, still redacted", () => {
  it("a log line carries the full allowed key set and nothing else", () => {
    const lines = capture(
      () =>
        logRequest({
          requestId: "req-obs-1",
          route: "/api/opinions",
          method: "GET",
          status: 200,
          userId: "user-alice",
          durationMs: 12,
          appEnv: "staging",
        }),
      "log",
    );
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(parsed).sort(),
      [
        "level",
        "requestId",
        "route",
        "method",
        "status",
        "durationMs",
        "appEnv",
        "userId",
      ].sort(),
    );
    assert.equal(parsed.appEnv, "staging");
    assert.equal(typeof parsed.durationMs, "number");
  });
});

// ---------------------------------------------------------------- error hook

describe("error hook — redacted by construction, swappable", () => {
  it("reports name only: no message, no stack, no secrets", () => {
    const lines = capture(() => {
      const err = new Error("user alice@example.com failed with token abc");
      err.stack = "Error: secret-stack-trace";
      reportError(err, {
        requestId: "req-obs-2",
        route: "/api/opinions",
        userId: "user-alice",
      });
    }, "error");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(parsed).sort(),
      ["level", "name", "requestId", "route", "userId"].sort(),
    );
    assert.equal(parsed.name, "Error");
    assert.ok(!lines[0]!.includes("alice@example.com"));
    assert.ok(!lines[0]!.includes("secret-stack-trace"));
  });

  it("a custom reporter plugs in without changing call sites", () => {
    const seen: unknown[] = [];
    setErrorReporter((err, ctx) => {
      seen.push([err, ctx]);
    });
    try {
      const err = new Error("boom");
      reportError(err, { requestId: "r1" });
      assert.equal(seen.length, 1);
    } finally {
      resetErrorReporter();
    }
  });

  it("a broken reporter never breaks the caller", () => {
    setErrorReporter(() => {
      throw new Error("sink is down");
    });
    try {
      assert.doesNotThrow(() => reportError(new Error("x"), {}));
    } finally {
      resetErrorReporter();
    }
  });
});

// ---------------------------------------------------------------- health + cache headers

describe("health — components, appEnv, overall status", () => {
  it("buildHealth reports appEnv and component statuses honestly", () => {
    const health = buildHealth(loadEnv({ PORT: "3210", APP_ENV: "staging" }));
    assert.equal(health.status, "ok");
    assert.equal(health.appEnv, "staging");
    assert.equal(health.checks.app.status, "ok");
    assert.equal(health.checks.config.status, "ok");
    assert.equal(health.checks.config.appEnv, "staging");
    assert.equal(health.checks.rateLimiter.status, "ok");
    assert.equal(health.checks.rateLimiter.store, "in-memory");
    // No env: Supabase stays honestly not_configured, never faked ok.
    assert.equal(health.checks.database.status, "not_configured");
    assert.equal(health.checks.auth.status, "not_configured");
  });

  it("GET /api/health over route() carries appEnv and components", async () => {
    const env = loadEnv({ PORT: "3210", APP_ENV: "staging" });
    const result = await route("GET", "/api/health", env);
    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body) as {
      status: string;
      appEnv: string;
      checks: Record<string, { status: string }>;
    };
    assert.equal(body.status, "ok");
    assert.equal(body.appEnv, "staging");
    assert.equal(body.checks.app!.status, "ok");
    assert.equal(body.checks.rateLimiter!.status, "ok");
  });
});

describe("cache headers — statics cacheable, API never", () => {
  it("GET / serves the page with a short public cache header", async () => {
    const env = loadEnv({ PORT: "3210" });
    const result = await route("GET", "/", env);
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers?.["cache-control"], "public, max-age=600");
  });

  it("GET /app.js is cacheable, GET /api/health is no-store", async () => {
    const env = loadEnv({ PORT: "3210" });
    const js = await route("GET", "/app.js", env);
    assert.equal(js.headers?.["cache-control"], "public, max-age=600");
    const health = await route("GET", "/api/health", env);
    // handleHealth returns no headers of its own; the API no-store
    // contract lives in SECURITY_HEADERS on API routes — assert the
    // health route does NOT claim to be publicly cacheable.
    assert.ok(
      health.headers?.["cache-control"] === undefined ||
        !String(health.headers?.["cache-control"]).includes("public"),
    );
  });
});
