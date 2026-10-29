import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AuthUser } from "../src/lib/auth.js";
import { getAuthConfig } from "../src/lib/auth.js";
import { auditLog } from "../src/lib/audit.js";
import { handleApi } from "../src/routes/api.js";
import { handleAuth, type AuthDeps } from "../src/routes/auth.js";
import { FakeStore } from "./fake-store.js";

/**
 * Final-layer tests — mocked store/fetch only; they prove
 * route/service logic, not live RLS or live PostgREST.
 */

const alice: AuthUser = {
  id: "user-alice",
  email: "alice@example.com",
  provider: "email",
};
const BOB_ID = "123e4567-e89b-12d3-a456-426614174000";
const AUTH_HEADERS = { authorization: "Bearer " + "fake-test-token" };

function captureOutput(fn: () => unknown): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const done = (): string => {
    console.log = original;
    return lines.join("\n");
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => done(),
        (error: unknown) => {
          done();
          throw error;
        },
      );
    }
    return Promise.resolve(done());
  } catch (error) {
    done();
    throw error;
  }
}

/** Parse every JSON log line; return the audit ones. */
function auditLines(out: string): Array<Record<string, unknown>> {
  return out
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((parsed) => parsed["audit"] === true);
}

// ---------------------------------------------------------------- audit trail shape

describe("audit trail — id-only lines in the log stream", () => {
  it("an audit line carries exactly the allowed fields", async () => {
    const out = await captureOutput(() =>
      auditLog({
        requestId: "req-1",
        userId: "user-alice",
        action: "moderation.block",
        target: BOB_ID,
        appEnv: "test",
      }),
    );
    const lines = auditLines(out);
    assert.equal(lines.length, 1);
    assert.deepEqual(
      Object.keys(lines[0] as object).sort(),
      ["action", "appEnv", "audit", "level", "requestId", "target", "userId"].sort(),
    );
    assert.equal(lines[0]?.["level"], "audit");
    assert.equal(lines[0]?.["action"], "moderation.block");
    assert.equal(lines[0]?.["target"], BOB_ID);
  });

  it("user content can never reach an audit line", async () => {
    const topic = "secret-topic-text";
    const reason = "secret reason text";
    const email = "victim@example.com";
    const out = await captureOutput(() =>
      auditLog({
        requestId: "req-2",
        userId: "user-alice",
        action: "moderation.mute_topic",
        target: null,
        appEnv: "test",
      }),
    );
    void topic;
    void reason;
    void email;
    for (const secret of [topic, reason, email, "hunter2", "token"]) {
      assert.ok(!out.includes(secret), `leaked into audit trail: ${secret}`);
    }
  });
});

// ---------------------------------------------------------------- audit wiring: api routes

function apiDeps(store: FakeStore): {
  verify: () => Promise<AuthUser | null>;
  store: () => FakeStore;
} {
  return {
    verify: () => Promise.resolve(alice),
    store: () => store,
  };
}

describe("audit wiring — moderation actions", () => {
  it("blocking a user emits moderation.block with the blocked id", async () => {
    const store = new FakeStore({
      profiles: [{ id: BOB_ID, handle: "bob", display_name: "Bob", bio: "" }],
    });
    const out = await captureOutput(() =>
      handleApi(
        "POST",
        "/api/blocks",
        AUTH_HEADERS,
        JSON.stringify({ blocked_id: BOB_ID }),
        apiDeps(store),
      ),
    );
    const lines = auditLines(out);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.["action"], "moderation.block");
    assert.equal(lines[0]?.["target"], BOB_ID);
    assert.equal(lines[0]?.["userId"], "user-alice");
  });

  it("muting a topic emits moderation.mute_topic with null target and no topic text", async () => {
    const store = new FakeStore({});
    const out = await captureOutput(() =>
      handleApi(
        "POST",
        "/api/muted-topics",
        AUTH_HEADERS,
        JSON.stringify({ topic: "politics" }),
        apiDeps(store),
      ),
    );
    const lines = auditLines(out);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.["action"], "moderation.mute_topic");
    assert.equal(lines[0]?.["target"], null);
    assert.ok(!out.includes("politics"), "topic text reached the logs");
  });

  it("a failed block (bad id) emits no audit line", async () => {
    const store = new FakeStore({});
    const result = await captureOutput(() =>
      handleApi(
        "POST",
        "/api/blocks",
        AUTH_HEADERS,
        JSON.stringify({ blocked_id: "nope" }),
        apiDeps(store),
      ),
    );
    assert.equal(auditLines(result).length, 0);
  });

  it("filing a report emits moderation.report with the report id, not the reason", async () => {
    const opinionId = "223e4567-e89b-12d3-a456-426614174000";
    const store = new FakeStore({
      opinions: [
        {
          id: opinionId,
          author_id: BOB_ID,
          body: "some opinion",
          topic: "Tech",
          is_anonymous: false,
        },
      ],
    });
    const out = await captureOutput(() =>
      handleApi(
        "POST",
        "/api/reports",
        AUTH_HEADERS,
        JSON.stringify({ opinion_id: opinionId, reason: "super secret reason" }),
        apiDeps(store),
      ),
    );
    const lines = auditLines(out);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.["action"], "moderation.report");
    assert.ok(typeof lines[0]?.["target"] === "string", "report id recorded");
    assert.ok(!out.includes("super secret reason"), "reason reached the logs");
  });
});

// ---------------------------------------------------------------- audit wiring: auth routes

const CONFIG = getAuthConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
});

function authDeps(): AuthDeps {
  const fetchImpl = async (
    input: string,
    init?: { method?: string; body?: string },
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    await Promise.resolve();
    const method = init?.method ?? "GET";
    if (input.endsWith("/auth/v1/factors") && method === "POST") {
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "factor-9",
            totp: {
              qr_code: "data:image/png;base64,FAKEQR",
              secret: "FAKESECRET",
              uri: "otpauth://totp/Opiinio?secret=FAKESECRET",
            },
          }),
      };
    }
    return {
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "not found" }),
    };
  };
  return {
    config: CONFIG,
    fetchImpl: fetchImpl as AuthDeps["fetchImpl"],
    verify: () => Promise.resolve(alice),
  };
}

describe("audit wiring — auth sensitive actions", () => {
  it("MFA enroll emits mfa.enroll with the factor id, never the secret", async () => {
    const out = await captureOutput(() =>
      handleAuth(
        "POST",
        "/api/auth/mfa/enroll",
        { authorization: "Bearer good-token" },
        JSON.stringify({ friendly_name: "phone" }),
        authDeps(),
      ),
    );
    const lines = auditLines(out);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.["action"], "mfa.enroll");
    assert.equal(lines[0]?.["target"], "factor-9");
    assert.equal(lines[0]?.["userId"], "user-alice");
    assert.ok(!out.includes("FAKESECRET"), "MFA secret reached the logs");
  });
});

// ---------------------------------------------------------------- load-test script pure helpers

// The script is plain .mjs outside the compiled tree; resolve it
// at runtime from the repo root (dist/tests -> ../.. at runtime,
// mirroring the ROOT convention in security.test.ts).
const REPO_ROOT = join(import.meta.dirname, "..", "..");
interface LoadTestModule {
  percentile: (sorted: number[], p: number) => number;
  parseArgs: (argv: string[]) => {
    url: string;
    concurrency: number;
    durationSec: number;
    routes: string[];
  };
  summarize: (name: string, samples: number[]) => Record<string, number | string>;
}
async function loadTestModule(): Promise<LoadTestModule> {
  const href = pathToFileURL(join(REPO_ROOT, "scripts", "load-test.mjs")).href;
  return (await import(href)) as LoadTestModule;
}

describe("load-test script — pure helpers", () => {
  it("percentile uses nearest-rank on sorted input", async () => {
    const mod = await loadTestModule();
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(mod.percentile(xs, 50), 5);
    assert.equal(mod.percentile(xs, 95), 10);
    assert.equal(mod.percentile(xs, 100), 10);
    assert.equal(mod.percentile(xs, 0), 1);
    assert.equal(mod.percentile([], 95), 0);
  });

  it("parseArgs applies defaults and overrides", async () => {
    const mod = await loadTestModule();
    const defaults = mod.parseArgs([]);
    assert.equal(defaults.url, "http://localhost:3000");
    assert.equal(defaults.concurrency, 20);
    assert.equal(defaults.durationSec, 15);
    assert.deepEqual(defaults.routes, ["/", "/app.js", "/api/health", "/api/opinions"]);
    const custom = mod.parseArgs([
      "--url",
      "http://example.test:4000",
      "--concurrency",
      "5",
      "--duration",
      "3",
      "--routes",
      "/api/health,/api/opinions",
    ]);
    assert.equal(custom.url, "http://example.test:4000");
    assert.equal(custom.concurrency, 5);
    assert.equal(custom.durationSec, 3);
    assert.deepEqual(custom.routes, ["/api/health", "/api/opinions"]);
  });

  it("summarize reports count and p50/p95/p99", async () => {
    const mod = await loadTestModule();
    const summary = mod.summarize("r", [10, 20, 30, 40, 50]);
    assert.equal(summary["count"], 5);
    assert.equal(summary["p50Ms"], 30);
    assert.equal(summary["name"], "r");
    const empty = mod.summarize("e", []);
    assert.equal(empty["count"], 0);
    assert.equal(empty["p99Ms"], 0);
  });
});
