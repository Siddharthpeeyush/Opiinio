import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bucketForApiRoute,
  bucketForAuthRoute,
  hashKeyPart,
  InMemoryRateLimitStore,
  isAuthStrictRoute,
  RATE_LIMIT_BUCKETS,
  RateLimiter,
} from "../src/lib/rateLimit.js";
import { ApiError } from "../src/lib/http.js";
import { handleAuth, type AuthDeps } from "../src/routes/auth.js";
import { handleApi, type ApiDeps } from "../src/routes/api.js";
import { route } from "../src/app.js";
import { getAuthConfig, type AuthConfig } from "../src/lib/auth.js";
import { FakeStore, seedStore } from "./fake-store.js";

/**
 * Layer 11 rate-limit tests — real code, mocked only at the
 * boundary the rules require (GoTrue fetch stub, FakeStore, no
 * live Supabase, no keys). Nothing here contacts a live
 * service: the shared in-memory store is the V1 shape, and the
 * distributed-store replacement is a documented follow-up,
 * not something these tests pretend to prove.
 */

const CONFIG: AuthConfig = getAuthConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
});

const alice = { id: "user-alice", email: "alice@example.com", provider: "email" };

function makeGoTrueStub() {
  const calls: string[] = [];
  const json = (value: unknown) => () => Promise.resolve(value);
  const fetchImpl = async (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    await Promise.resolve();
    calls.push(input);
    if (
      input.includes("/auth/v1/token?grant_type=password") &&
      (init?.method ?? "GET") === "POST"
    ) {
      return {
        ok: true,
        status: 200,
        json: json({
          access_token: "stub-access-token",
          refresh_token: "stub-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          user: { id: "user-alice", email: "alice@example.com" },
        }),
      };
    }
    return { ok: false, status: 404, json: json({ error: "not stubbed" }) };
  };
  return { fetchImpl, calls };
}

const STRICT_ONLY = {
  authStrict: { limit: 1, windowMs: 15 * 60 * 1000 },
  authGeneral: { limit: 1, windowMs: 15 * 60 * 1000 },
  write: { limit: 1, windowMs: 5 * 60 * 1000 },
  read: { limit: 1, windowMs: 5 * 60 * 1000 },
  search: { limit: 1, windowMs: 5 * 60 * 1000 },
} as const;

function limitedRateLimit(): (routePattern: string, key?: string) => Promise<void> {
  const limiter = new RateLimiter(new InMemoryRateLimitStore(), STRICT_ONLY);
  return async (pattern: string, key?: string) => {
    const keys = key !== undefined ? [key] : ["ip:test"];
    await limiter.checkAuthRoute(pattern, keys);
  };
}

describe("InMemoryRateLimitStore — fixed window", () => {
  it("allows up to the limit, then denies with a positive retry-after", async () => {
    const store = new InMemoryRateLimitStore();
    assert.equal((await store.consume("k", 2, 60_000, 0)).allowed, true);
    assert.equal((await store.consume("k", 2, 60_000, 100)).allowed, true);
    const denied = await store.consume("k", 2, 60_000, 200);
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSeconds > 0);
  });

  it("the window resets after it expires", async () => {
    const store = new InMemoryRateLimitStore();
    await store.consume("k", 1, 1_000, 0);
    assert.equal((await store.consume("k", 1, 1_000, 500)).allowed, false);
    assert.equal((await store.consume("k", 1, 1_000, 1_500)).allowed, true);
  });

  it("keys are independent", async () => {
    const store = new InMemoryRateLimitStore();
    await store.consume("a", 1, 60_000, 0);
    assert.equal((await store.consume("a", 1, 60_000, 10)).allowed, false);
    assert.equal((await store.consume("b", 1, 60_000, 10)).allowed, true);
  });
});

describe("hashKeyPart — IPs/emails never become raw keys", () => {
  it("is deterministic and one-way", () => {
    const first = hashKeyPart("203.0.113.9");
    assert.equal(first, hashKeyPart("203.0.113.9"));
    assert.notEqual(first, hashKeyPart("203.0.113.10"));
    assert.ok(!first.includes("203.0.113.9"));
  });
});

describe("bucket mapping", () => {
  it("strict auth routes are signup/signin/reset only", () => {
    for (const pattern of ["/api/auth/signup", "/api/auth/signin", "/api/auth/reset"]) {
      assert.equal(isAuthStrictRoute(pattern), true);
      assert.equal(bucketForAuthRoute(pattern), "authStrict");
    }
    for (const pattern of [
      "/api/auth/refresh",
      "/api/auth/google",
      "/api/auth/session",
      "/api/auth/password",
      "/api/auth/account",
    ]) {
      assert.equal(isAuthStrictRoute(pattern), false);
      assert.equal(bucketForAuthRoute(pattern), "authGeneral");
    }
    // 5 attempts per 15 minutes on the strict bucket (playbook rule).
    assert.equal(RATE_LIMIT_BUCKETS.authStrict.limit, 5);
    assert.equal(RATE_LIMIT_BUCKETS.authStrict.windowMs, 15 * 60 * 1000);
  });

  it("api routes map GET to read, search to search, everything else to write", () => {
    assert.equal(bucketForApiRoute("GET", ["opinions"], false), "read");
    assert.equal(bucketForApiRoute("GET", ["opinions"], true), "search");
    assert.equal(bucketForApiRoute("POST", ["opinions"], false), "write");
    assert.equal(bucketForApiRoute("POST", ["replies", "x", "like"], false), "write");
    assert.equal(bucketForApiRoute("DELETE", ["replies", "x", "like"], false), "write");
  });
});

describe("RateLimiter — generic 429, no personal data", () => {
  it("throws a generic 429 with Retry-After and no personal data in the body", async () => {
    const limiter = new RateLimiter(new InMemoryRateLimitStore(), STRICT_ONLY);
    await limiter.check("write", "user:user-alice");
    const error = await limiter
      .check("write", "user:user-alice")
      .catch((e: unknown) => e);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "RATE_LIMITED");
    assert.ok(error.retryAfterSeconds !== undefined && error.retryAfterSeconds > 0);
    const body = JSON.stringify({ code: error.code, message: error.message });
    assert.ok(!body.includes("alice@example.com"));
    assert.ok(!body.includes("203.0.113.9"));
  });

  it("checkAuthRoute requires every supplied key to pass", async () => {
    const buckets = {
      ...STRICT_ONLY,
      authStrict: { limit: 2, windowMs: 15 * 60 * 1000 },
    };
    const limiter = new RateLimiter(new InMemoryRateLimitStore(), buckets);
    const rejects429 = async (promise: Promise<unknown>) =>
      assert.rejects(promise, (e: unknown) => e instanceof ApiError && e.status === 429);
    // Two attempts pass (both keys have budget), the third is denied.
    await limiter.checkAuthRoute("/api/auth/signin", ["email:h1", "ip:h2"]);
    await limiter.checkAuthRoute("/api/auth/signin", ["email:h1", "ip:h2"]);
    await rejects429(limiter.checkAuthRoute("/api/auth/signin", ["email:h1", "ip:h2"]));
    // The IP budget is spent too, so a different email from the
    // same IP is also blocked — the documented shared-IP
    // trade-off of the strict bucket.
    await rejects429(limiter.checkAuthRoute("/api/auth/signin", ["email:h9", "ip:h2"]));
    // The per-email key is still independent: a different email
    // from a different IP gets its own budget.
    await limiter.checkAuthRoute("/api/auth/signin", ["email:h9", "ip:h3"]);
  });
});

describe("auth routes — a limiting hook gives 429 with zero GoTrue calls", () => {
  function baseDeps(stub: ReturnType<typeof makeGoTrueStub>): AuthDeps {
    return {
      config: CONFIG,
      fetchImpl: stub.fetchImpl,
      verify: async () => {
        await Promise.resolve();
        return alice;
      },
      rateLimit: limitedRateLimit(),
    };
  }

  it("first signin passes, second is 429 and GoTrue is never reached again", async () => {
    const stub = makeGoTrueStub();
    const deps = baseDeps(stub);
    const body = JSON.stringify({
      email: "alice@example.com",
      password: "correct-password-123",
    });
    const headers = {};
    const first = await handleAuth("POST", "/api/auth/signin", headers, body, deps);
    assert.equal(first.statusCode, 200);
    const gotrueCallsAfterFirst = stub.calls.length;
    assert.ok(gotrueCallsAfterFirst > 0, "the first attempt reaches GoTrue");
    const second = await handleAuth("POST", "/api/auth/signin", headers, body, deps);
    assert.equal(second.statusCode, 429);
    assert.equal(
      stub.calls.length,
      gotrueCallsAfterFirst,
      "the denied request never reaches GoTrue",
    );
    assert.ok(second.headers["retry-after"] !== undefined, "Retry-After is present");
    const bodyText = JSON.stringify(second.body);
    assert.ok(!bodyText.includes("alice@example.com"), "429 body carries no email");
    assert.ok(!bodyText.includes("203.0.113"), "429 body carries no IP");
    assert.equal(
      (JSON.parse(second.body) as { error: { code?: string } }).error.code,
      "RATE_LIMITED",
    );
  });

  it("signout is deliberately NOT rate-limited (never traps a user)", async () => {
    const stub = makeGoTrueStub();
    const deps = baseDeps(stub);
    // The route does not call the rate-limit hook at all: calling
    // handleAuth with a hook that throws on any use proves it.
    const exploding = async () => {
      await Promise.resolve();
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts, try again later");
    };
    const result = await handleAuth(
      "POST",
      "/api/auth/signout",
      { authorization: "Bearer stub-token" },
      null,
      { ...deps, rateLimit: exploding },
    );
    assert.equal(result.statusCode, 200);
  });

  it("unauthenticated sensitive routes still authenticate first (429 is not an oracle)", async () => {
    const stub = makeGoTrueStub();
    const deps = baseDeps(stub);
    const result = await handleAuth(
      "DELETE",
      "/api/auth/account",
      { authorization: "Bearer bogus-token" },
      null,
      {
        ...deps,
        verify: async () => {
          await Promise.resolve();
          return null;
        },
      },
    );
    assert.equal(result.statusCode, 401, "bad token is 401, not 429");
  });
});

describe("api routes — reads and writes limited before the store", () => {
  it("GET /api/opinions: first passes, second is 429, store not created again", async () => {
    let stores = 0;
    const deps: ApiDeps = {
      verify: async () => {
        await Promise.resolve();
        return null;
      },
      store: () => {
        stores += 1;
        return new FakeStore();
      },
      rateLimiter: new RateLimiter(new InMemoryRateLimitStore(), STRICT_ONLY),
      clientIp: "203.0.113.9",
    };
    const first = await handleApi("GET", "/api/opinions", {}, null, deps);
    assert.equal(first.statusCode, 200);
    assert.equal(stores, 1);
    const second = await handleApi("GET", "/api/opinions", {}, null, deps);
    assert.equal(second.statusCode, 429);
    assert.equal(stores, 1, "the denied request never reaches the store");
    assert.ok(second.headers["retry-after"] !== undefined);
    assert.ok(!JSON.stringify(second.body).includes("203.0.113"));
  });

  it("POST /api/opinions: write bucket enforced per user", async () => {
    const store = seedStore();
    const deps: ApiDeps = {
      verify: async () => {
        await Promise.resolve();
        return alice;
      },
      store: () => store,
      rateLimiter: new RateLimiter(new InMemoryRateLimitStore(), STRICT_ONLY),
      clientIp: "203.0.113.9",
    };
    const headers = { authorization: "Bearer stub-token" };
    const first = await handleApi(
      "POST",
      "/api/opinions",
      headers,
      JSON.stringify({ body: "Limit test", topic: "Money" }),
      deps,
    );
    assert.equal(first.statusCode, 201);
    const second = await handleApi(
      "POST",
      "/api/opinions",
      headers,
      JSON.stringify({ body: "Limit test again", topic: "Money" }),
      deps,
    );
    assert.equal(second.statusCode, 429);
  });

  it("route-table 404 happens before rate limiting", async () => {
    const deps: ApiDeps = {
      verify: async () => {
        await Promise.resolve();
        return null;
      },
      store: () => new FakeStore(),
      rateLimiter: new RateLimiter(new InMemoryRateLimitStore(), STRICT_ONLY),
      clientIp: "203.0.113.9",
    };
    const result = await handleApi("GET", "/api/nope-not-real", {}, null, deps);
    assert.equal(result.statusCode, 404);
  });
});

describe("route() production wiring — limiter flows into both route families", () => {
  it("route() GET /api/opinions enforces the shared limiter", async () => {
    const result = { count: 0 };
    const apiDeps: ApiDeps = {
      verify: async () => {
        await Promise.resolve();
        return null;
      },
      store: () => {
        result.count += 1;
        return new FakeStore();
      },
      appOrigin: "http://localhost",
    };
    const env = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "x",
      APP_ORIGIN: "http://localhost",
    };
    const opts = (limiter: RateLimiter) => ({
      apiDeps,
      rateLimiter: limiter,
      clientIp: "203.0.113.9",
      headers: { origin: "http://localhost" },
    });
    const oneShot = new RateLimiter(new InMemoryRateLimitStore(), STRICT_ONLY);
    const first = await route("GET", "/api/opinions", env as never, opts(oneShot));
    assert.equal(first.statusCode, 200);
    const second = await route("GET", "/api/opinions", env as never, opts(oneShot));
    assert.equal(second.statusCode, 429);
    assert.equal(result.count, 1, "second request stopped before the store");
  });

  it("route() POST /api/auth/signin enforces via the built-in adapter (no authDeps.rateLimit needed)", async () => {
    const stub = makeGoTrueStub();
    const authDeps: AuthDeps = {
      config: CONFIG,
      fetchImpl: stub.fetchImpl,
      appOrigin: "http://localhost",
    };
    const oneShot = new RateLimiter(new InMemoryRateLimitStore(), STRICT_ONLY);
    const opts = {
      authDeps,
      rateLimiter: oneShot,
      clientIp: "203.0.113.9",
      headers: { origin: "http://localhost" },
    };
    const body = JSON.stringify({
      email: "alice@example.com",
      password: "correct-password-123",
    });
    const first = await route("POST", "/api/auth/signin", {} as never, {
      ...opts,
      bodyText: body,
    });
    assert.equal(first.statusCode, 200);
    const second = await route("POST", "/api/auth/signin", {} as never, {
      ...opts,
      bodyText: body,
    });
    assert.equal(second.statusCode, 429);
    assert.ok((second.headers ?? {})["retry-after"] !== undefined);
  });
});

describe("reply-like — live mode calls the API, preview mode keeps the toast (static)", () => {
  const sourcePath = join(process.cwd(), "public", "app.js");

  it("preview branch keeps the exact preview toast", async () => {
    const source = await readFile(sourcePath, "utf8");
    assert.ok(
      source.includes(
        'if (action === "reply-like") {\n      if (isPreview()) {\n        showToast("Preview only — reply likes are local in preview and are not saved.");',
      ),
      "the preview toast branch must stay exactly as it was",
    );
  });

  it("live branch calls POST/DELETE /replies/:id/like by ownLiked, then refetches from the server", async () => {
    const source = await readFile(sourcePath, "utf8");
    assert.ok(
      source.includes('await api("/replies/" + replyId + "/like", {'),
      "live mode calls the live like endpoint",
    );
    assert.ok(
      source.includes('method: liveReply && liveReply.ownLiked ? "DELETE" : "POST"'),
      "unlike uses DELETE, like uses POST, chosen from the server-known ownLiked flag",
    );
    assert.ok(
      source.includes("liveReply = (state.livePostReplies || []).find"),
      "ownLiked is read from the server-fetched reply view, not from a preview guess",
    );
    // The count is refreshed by re-rendering (route() refetches the
    // post from the server), never by local arithmetic.
    const branch = source.slice(source.indexOf('if (action === "reply-like")'));
    assert.ok(branch.includes("route();"), "live branch refetches after the call");
  });

  it("live branch shows the generic error state on failure", async () => {
    const source = await readFile(sourcePath, "utf8");
    const branch = source.slice(source.indexOf('if (action === "reply-like")'));
    assert.ok(
      branch.includes('"Could not save your like."'),
      "failures show the generic error toast, not the preview toast",
    );
    assert.ok(
      branch.includes('"Sign in required to like."'),
      "a 401 in live mode says sign in is required",
    );
  });
});
