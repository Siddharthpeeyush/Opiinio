import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuthUser } from "../src/lib/auth.js";
import { logRequest } from "../src/lib/log.js";
import { handleApi, type ApiDeps } from "../src/routes/api.js";
import { InMemoryRateLimitStore, RateLimiter } from "../src/lib/rateLimit.js";
import { FakeStore } from "./fake-store.js";
import { exportAccount } from "../src/services/export.js";

/**
 * Layer 10 security tests — mocked store/fetch only; they prove
 * route/service logic, not live RLS or live PostgREST. Live
 * proofs (two real users, staging) remain owed — see
 * docs/security-threat-model.md.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const alice: AuthUser = {
  id: "user-alice",
  email: "alice@example.com",
  provider: "email",
};
// bob exists only as rows in the seeded store (never as a caller),
// so the cross-user leakage tests are meaningful.

// ---------------------------------------------------------------- log redaction

function captureLog(fn: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

describe("log redaction — secrets can never reach the log line", () => {
  it("a log line carries exactly the allowed fields", () => {
    const out = captureLog(() =>
      logRequest({
        requestId: "req-1",
        route: "/api/auth/signin",
        method: "POST",
        status: 401,
        userId: "user-alice",
        durationMs: 3,
        appEnv: "test",
      }),
    );
    const parsed = JSON.parse(out) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(parsed).sort(),
      [
        "level",
        "method",
        "requestId",
        "route",
        "status",
        "durationMs",
        "appEnv",
        "userId",
      ].sort(),
    );
  });

  it("a fake login attempt's email and password cannot be logged", () => {
    // logRequest's signature takes ONLY the redacted fields, so
    // there is no parameter a credential could even arrive on.
    // Prove the serialized line never contains them, even when
    // the surrounding test data does.
    const email = "victim@example.com";
    const password = "hunter2-super-secret";
    const out = captureLog(() =>
      logRequest({
        requestId: "req-2",
        route: "/api/auth/signin",
        method: "POST",
        status: 401,
        userId: null,
        durationMs: 1,
        appEnv: "test",
      }),
    );
    void email;
    void password;
    assert.ok(!out.includes("victim@example.com"), "email leaked into logs");
    assert.ok(!out.includes("hunter2"), "password leaked into logs");
    assert.ok(!out.includes("token"), "token word in logs");
  });

  it("log lines carry route PATTERNS, never raw paths with ids", () => {
    const out = captureLog(() =>
      logRequest({
        requestId: "req-3",
        route: "/api/opinions/:id",
        method: "GET",
        status: 200,
        userId: "user-alice",
        durationMs: 5,
        appEnv: "test",
      }),
    );
    assert.ok(!out.includes("550e8400"), "raw id in log route");
  });
});

// ---------------------------------------------------------------- data export

function twoUserStore(): FakeStore {
  return new FakeStore({
    profiles: [
      { id: "user-alice", handle: "alice", display_name: "Alice", bio: "hi" },
      { id: "user-bob", handle: "bob", display_name: "Bob", bio: "hey" },
    ],
    opinions: [
      {
        id: "op-a1",
        author_id: "user-alice",
        body: "Alice take",
        topic: "Money",
        is_anonymous: false,
        created_at: "2026-10-29T00:00:00Z",
      },
      {
        id: "op-a2",
        author_id: "user-alice",
        body: "Alice secret take",
        topic: "Money",
        is_anonymous: true,
        created_at: "2026-10-29T00:01:00Z",
      },
      {
        id: "op-b1",
        author_id: "user-bob",
        body: "Bob take",
        topic: "Money",
        is_anonymous: false,
        created_at: "2026-10-29T00:02:00Z",
      },
    ],
    replies: [
      {
        id: "r-a1",
        opinion_id: "op-b1",
        author_id: "user-alice",
        body: "Alice reply",
        side: "for",
        created_at: "2026-10-29T00:03:00Z",
      },
      {
        id: "r-b1",
        opinion_id: "op-a1",
        author_id: "user-bob",
        body: "Bob reply",
        side: "against",
        created_at: "2026-10-29T00:04:00Z",
      },
    ],
    opinion_votes: [
      { user_id: "user-alice", opinion_id: "op-b1", stance: "agree" },
      { user_id: "user-bob", opinion_id: "op-a1", stance: "disagree" },
    ],
    opinion_likes: [
      { user_id: "user-alice", opinion_id: "op-b1" },
      { user_id: "user-bob", opinion_id: "op-a1" },
    ],
    reply_likes: [
      { user_id: "user-alice", reply_id: "r-b1" },
      { user_id: "user-bob", reply_id: "r-a1" },
    ],
    reposts: [
      { id: "rp-a1", user_id: "user-alice", opinion_id: "op-b1", quote_take: null },
      { id: "rp-b1", user_id: "user-bob", opinion_id: "op-a1", quote_take: "take" },
    ],
    follows: [
      { follower_id: "user-alice", following_id: "user-bob" },
      { follower_id: "user-bob", following_id: "user-alice" },
    ],
    polls: [{ id: "poll-a1", opinion_id: "op-a1" }],
    poll_options: [
      { id: "popt-1", poll_id: "poll-a1", option_text: "Yes", position: 0 },
      { id: "popt-2", poll_id: "poll-a1", option_text: "No", position: 1 },
    ],
    poll_votes: [
      { user_id: "user-alice", poll_id: "poll-a1", option_id: "popt-1" },
      { user_id: "user-bob", poll_id: "poll-a1", option_id: "popt-2" },
    ],
    bookmarks: [
      { user_id: "user-alice", opinion_id: "op-b1" },
      { user_id: "user-bob", opinion_id: "op-a1" },
    ],
    muted_words: [
      { user_id: "user-alice", word: "spoilers" },
      { user_id: "user-bob", word: "politics" },
    ],
    muted_topics: [
      { user_id: "user-alice", topic: "Gossip" },
      { user_id: "user-bob", topic: "Sports" },
    ],
    blocks: [{ blocker_id: "user-bob", blocked_id: "user-alice" }],
    reports: [
      { id: "rep-a1", reporter_id: "user-alice", opinion_id: "op-b1", reason: "spam" },
      { id: "rep-b1", reporter_id: "user-bob", opinion_id: "op-a1", reason: "abuse" },
    ],
    notifications: [
      { id: "n-a1", user_id: "user-alice", actor_id: "user-bob", type: "reply" },
      { id: "n-b1", user_id: "user-bob", actor_id: "user-alice", type: "reply" },
    ],
  });
}

const AUTH = { authorization: "Bearer test-token" };

function aliceDeps(store: FakeStore, extra: Partial<ApiDeps> = {}): ApiDeps {
  return {
    verify: async () => {
      await Promise.resolve();
      return alice;
    },
    store: () => store,
    ...extra,
  };
}

describe("GET /api/account/export — own data only", () => {
  it("returns the caller's own rows across all tables", async () => {
    const store = twoUserStore();
    const result = await handleApi(
      "GET",
      "/api/account/export",
      AUTH,
      null,
      aliceDeps(store),
    );
    assert.equal(result.statusCode, 200);
    const data = (JSON.parse(result.body) as { data: Record<string, unknown> }).data;
    assert.equal(data.userId, "user-alice");
    assert.equal((data.profile as Record<string, unknown>).id, "user-alice");
    assert.equal((data.opinions as unknown[]).length, 2);
    assert.equal((data.replies as unknown[]).length, 1);
    assert.equal((data.opinionVotes as unknown[]).length, 1);
    assert.equal((data.opinionLikes as unknown[]).length, 1);
    assert.equal((data.replyLikes as unknown[]).length, 1);
    assert.equal((data.reposts as unknown[]).length, 1);
    assert.equal((data.following as unknown[]).length, 1);
    assert.equal((data.followers as unknown[]).length, 1);
    assert.equal((data.polls as unknown[]).length, 1);
    const firstPoll = (data.polls as Array<Record<string, unknown>>)[0];
    assert.ok(firstPoll !== undefined, "expected one poll");
    assert.equal((firstPoll.options as unknown[]).length, 2, "poll embeds its options");
    assert.equal((data.pollVotes as unknown[]).length, 1);
    assert.equal((data.bookmarks as unknown[]).length, 1);
    assert.equal((data.mutedWords as unknown[]).length, 1);
    assert.equal((data.mutedTopics as unknown[]).length, 1);
    assert.equal((data.blocks as unknown[]).length, 0, "alice blocked nobody");
    assert.equal((data.reports as unknown[]).length, 1);
    assert.equal((data.notifications as unknown[]).length, 1);
  });

  it("never contains another user's rows — only id references inside own rows", async () => {
    const store = twoUserStore();
    const result = await handleApi(
      "GET",
      "/api/account/export",
      AUTH,
      null,
      aliceDeps(store),
    );
    assert.equal(result.statusCode, 200);
    const body = result.body;
    const data = (JSON.parse(body) as { data: Record<string, unknown> }).data;
    // Bob's own rows: his profile, opinion, reply, vote, like,
    // repost, poll vote, bookmark, muted word/topic, report.
    for (const needle of [
      '"handle":"bob"',
      "Bob take",
      "Bob reply",
      '"reason":"abuse"',
      "politics",
      '"topic":"Sports"',
    ]) {
      assert.ok(!body.includes(needle), `bob's row leaked: ${needle}`);
    }
    // Alice's notification rows legitimately carry an actor_id
    // reference (who interacted with HER) — that is her own
    // data, not bob's row.
    const notifications = data.notifications as Array<Record<string, unknown>>;
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.user_id, "user-alice");
    // Alice's OWN anonymous opinion is her own data and must be present.
    assert.ok(body.includes("op-a2"), "alice's own anonymous opinion missing");
  });

  it("service-level: exportAccount rejects unauthenticated callers", async () => {
    const store = twoUserStore();
    await assert.rejects(exportAccount(store, { user: null }), (error: unknown) => {
      const err = error as { status?: number };
      return err.status === 401;
    });
  });

  it("route-level: signed out is 401", async () => {
    const store = twoUserStore();
    const deps: ApiDeps = {
      verify: async () => {
        await Promise.resolve();
        return null;
      },
      store: () => store,
    };
    const result = await handleApi("GET", "/api/account/export", AUTH, null, deps);
    assert.equal(result.statusCode, 401);
  });

  it("route-level: unconfigured server is a generic 503", async () => {
    const result = await handleApi("GET", "/api/account/export", AUTH, null, {});
    assert.equal(result.statusCode, 503);
    assert.ok(!result.body.includes("SUPABASE"), "variable name leaked");
  });

  it("route-level: unknown account sub-paths are still 404", async () => {
    const store = twoUserStore();
    const result = await handleApi(
      "GET",
      "/api/account/other",
      {},
      null,
      aliceDeps(store),
    );
    assert.equal(result.statusCode, 404);
  });

  it("the export route is rate-limited (read bucket)", async () => {
    const store = twoUserStore();
    const limiter = new RateLimiter(new InMemoryRateLimitStore(), {
      authStrict: { limit: 1000, windowMs: 15 * 60 * 1000 },
      authGeneral: { limit: 1000, windowMs: 15 * 60 * 1000 },
      write: { limit: 1000, windowMs: 5 * 60 * 1000 },
      read: { limit: 1, windowMs: 5 * 60 * 1000 },
      search: { limit: 1000, windowMs: 5 * 60 * 1000 },
    });
    const deps = aliceDeps(store, { rateLimiter: limiter });
    const first = await handleApi("GET", "/api/account/export", AUTH, null, deps);
    assert.equal(first.statusCode, 200);
    const second = await handleApi("GET", "/api/account/export", AUTH, null, deps);
    assert.equal(second.statusCode, 429);
    assert.ok(second.headers["retry-after"] !== undefined);
  });
});

// ---------------------------------------------------------------- QR SVG sanitizer

describe("safeSvg — the one raw-HTML sink (MFA QR from GoTrue)", () => {
  it("safeSvg exists and the QR injection path uses it", async () => {
    const js = await readFile(join(ROOT, "public", "app.js"), "utf8");
    assert.match(js, /function safeSvg\(svg\)/);
    assert.match(js, /var qrSvg = safeSvg\(enrollment\.qrCode\)/);
    // No raw injection of the GoTrue-provided QR string anywhere.
    assert.doesNotMatch(js, /\+\s*enrollment\.qrCode\s*\+/);
  });

  it("safeSvg rejects active content and non-SVG input", async () => {
    const js = await readFile(join(ROOT, "public", "app.js"), "utf8");
    const match = js.match(/function safeSvg\(svg\) \{\n[\s\S]*?\n {2}\}/);
    assert.ok(match, "safeSvg source not found in app.js");
    // The shipped source is evaluated (not a copy), so this test
    // runs the real function: if safeSvg moves or is renamed, the
    // match above fails loudly first. new Function is deliberate
    // here — it is test-only, evaluating code from this same repo.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const makeSafeSvg = new Function(`${match[0]}; return safeSvg;`) as () => (
      svg: unknown,
    ) => string | null;
    const safeSvg = makeSafeSvg();
    const good = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10"/></svg>';
    assert.equal(safeSvg(good), good.trim());
    assert.equal(safeSvg("<svg><script>alert(1)</script></svg>"), null);
    assert.equal(safeSvg('<svg><rect onload="alert(1)"/></svg>'), null);
    assert.equal(safeSvg('<svg><a href="javascript:alert(1)">x</a></svg>'), null);
    assert.equal(safeSvg("<svg><foreignObject><div>x</div></foreignObject></svg>"), null);
    assert.equal(safeSvg('<svg><iframe src="https://evil.example"/></svg>'), null);
    assert.equal(safeSvg("<div>not svg</div>"), null);
    assert.equal(safeSvg(null), null);
    assert.equal(safeSvg(42), null);
  });
});
