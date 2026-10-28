import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AuthUnavailableError,
  deniedStatus,
  extractBearerToken,
  getAuthConfig,
  verifySession,
  type AuthUser,
} from "../src/lib/auth.js";
import { can, isPrivateTable, type Resource } from "../src/services/permissions.js";
import { initialsFor, maskAuthor, maskOpinion } from "../src/services/anonymous.js";
import { buildHealth } from "../src/services/healthService.js";
import { loadEnv } from "../src/lib/env.js";

/**
 * Layer 4 auth tests — pure logic + file proof, no live Supabase.
 *
 * verifySession is tested against an injected fetch stub that
 * returns canned GoTrue responses; it never contacts a real
 * project (no key has been shared). The live cross-user proof
 * (two real Auth users, one requesting the other's private row)
 * is a dashboard step in AUTH-SETUP-GUIDE.md §5, not something
 * these tests can fake, and it is listed as skipped in the
 * Layer 4 report.
 *
 * A test that only asserted on a mock permission object would
 * still pass if permissions.ts were deleted; these tests import
 * the real can()/mask functions and the real migration file.
 */

const alice: AuthUser = {
  id: "user-alice",
  email: "alice@example.com",
  provider: "email",
};
const bob: AuthUser = { id: "user-bob", email: "bob@example.com", provider: "google" };
const visitor: AuthUser | null = null;

function own(type: Resource["type"], ownerId: string): Resource {
  return { type, ownerId };
}

describe("can() — public reads", () => {
  it("visitors may read public tables but nothing private", () => {
    for (const type of [
      "profiles",
      "daily_questions",
      "opinions",
      "replies",
      "opinion_likes",
      "reply_likes",
      "reposts",
      "follows",
      "polls",
      "poll_options",
    ] as const) {
      assert.equal(can(visitor, "read", { type }), true, `visitor should read ${type}`);
    }
    for (const type of [
      "opinion_votes",
      "poll_votes",
      "bookmarks",
      "muted_topics",
      "muted_words",
      "blocks",
      "reports",
      "notifications",
    ] as const) {
      assert.equal(
        can(visitor, "read", { type, ownerId: "user-alice" }),
        false,
        `visitor must not read ${type}`,
      );
      assert.equal(isPrivateTable(type), true, `${type} must be marked private`);
    }
  });

  it("visitors may write nothing", () => {
    assert.equal(can(visitor, "create", own("opinions", "user-alice")), false);
    assert.equal(can(visitor, "update", own("opinions", "user-alice")), false);
    assert.equal(can(visitor, "delete", own("opinions", "user-alice")), false);
    assert.equal(can(visitor, "create", own("bookmarks", "user-alice")), false);
  });
});

describe("can() — own vs other user", () => {
  it("owners may write their own rows; other users may not", () => {
    assert.equal(can(alice, "create", own("opinions", "user-alice")), true);
    assert.equal(can(bob, "create", own("opinions", "user-alice")), false);
    assert.equal(can(alice, "update", own("opinions", "user-alice")), true);
    assert.equal(can(bob, "update", own("opinions", "user-alice")), false);
    assert.equal(can(alice, "delete", own("opinions", "user-alice")), true);
    assert.equal(can(bob, "delete", own("opinions", "user-alice")), false);
    assert.equal(can(alice, "read", own("bookmarks", "user-alice")), true);
    assert.equal(can(bob, "read", own("bookmarks", "user-alice")), false);
    assert.equal(can(alice, "read", own("notifications", "user-alice")), true);
    assert.equal(can(bob, "read", own("notifications", "user-alice")), false);
  });

  it("stance votes may be changed but poll votes are locked", () => {
    assert.equal(can(alice, "update", own("opinion_votes", "user-alice")), true);
    assert.equal(can(alice, "update", own("poll_votes", "user-alice")), false);
    assert.equal(can(alice, "delete", own("poll_votes", "user-alice")), true);
  });

  it("server-only tables reject regular-user writes", () => {
    assert.equal(can(alice, "create", own("daily_questions", "user-alice")), false);
    assert.equal(can(alice, "create", own("notifications", "user-alice")), false);
    assert.equal(can(alice, "update", own("daily_questions", "user-alice")), false);
    assert.equal(can(alice, "delete", own("notifications", "user-alice")), false);
    // Mark-read is the one allowed notifications update.
    assert.equal(can(alice, "update", own("notifications", "user-alice")), true);
  });

  it("likes/reposts/bookmarks/reports have no update policy", () => {
    for (const type of [
      "opinion_likes",
      "reply_likes",
      "reposts",
      "bookmarks",
      "reports",
      "poll_options",
    ] as const) {
      assert.equal(
        can(alice, "update", own(type, "user-alice")),
        false,
        `${type} update`,
      );
    }
  });

  it("follows block self-follow; blocks block self-block; follow delete allows either side", () => {
    assert.equal(
      can(alice, "create", {
        type: "follows",
        ownerId: "user-alice",
        followingId: "user-alice",
      }),
      false,
      "self-follow must be denied",
    );
    assert.equal(
      can(alice, "create", {
        type: "follows",
        ownerId: "user-alice",
        followingId: "user-bob",
      }),
      true,
    );
    assert.equal(
      can(alice, "create", {
        type: "blocks",
        ownerId: "user-alice",
        blockedId: "user-alice",
      }),
      false,
      "self-block must be denied",
    );
    assert.equal(
      can(alice, "delete", {
        type: "follows",
        ownerId: "user-bob",
        followingId: "user-alice",
      }),
      true,
      "followed user may remove a follower",
    );
    assert.equal(
      can(bob, "delete", {
        type: "follows",
        ownerId: "user-alice",
        followingId: "user-bob",
      }),
      true,
      "followed user may remove a follower (bob is the following user here)",
    );
    assert.equal(
      can(alice, "delete", {
        type: "follows",
        ownerId: "user-bob",
        followingId: "user-bob",
      }),
      false,
      "a user who is neither follower nor following may not delete the follow",
    );
  });

  it("polls are created/deleted only by the opinion author", () => {
    assert.equal(
      can(alice, "create", { type: "polls", opinionAuthorId: "user-alice" }),
      true,
    );
    assert.equal(
      can(bob, "create", { type: "polls", opinionAuthorId: "user-alice" }),
      false,
    );
    assert.equal(
      can(alice, "create", { type: "poll_options", opinionAuthorId: "user-alice" }),
      true,
    );
    assert.equal(
      can(bob, "delete", { type: "polls", opinionAuthorId: "user-alice" }),
      false,
    );
    assert.equal(
      can(alice, "delete", { type: "polls", opinionAuthorId: "user-alice" }),
      true,
    );
  });
});

describe("deniedStatus() — 401 / 403 / 404 mapping", () => {
  it("no user is always 401", () => {
    assert.equal(deniedStatus(visitor, { privateResource: true }), 401);
    assert.equal(deniedStatus(visitor, { privateResource: false }), 401);
  });

  it("another user's private row is 404, a public forbidden action is 403", () => {
    assert.equal(deniedStatus(alice, { privateResource: true }), 404);
    assert.equal(deniedStatus(alice, { privateResource: false }), 403);
  });
});

describe("extractBearerToken()", () => {
  it("parses Bearer tokens and rejects malformed headers without leaking them", () => {
    assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(extractBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(extractBearerToken(null), null);
    assert.equal(extractBearerToken(undefined), null);
    assert.equal(extractBearerToken(""), null);
    assert.equal(extractBearerToken("Basic abc"), null);
    assert.equal(extractBearerToken("Bearer"), null);
    assert.equal(extractBearerToken("Bearer   "), null);
  });
});

describe("getAuthConfig() — fails clearly, never fakes a session", () => {
  it("throws naming the missing variable, never a value", () => {
    assert.throws(() => getAuthConfig({}), /SUPABASE_URL/);
    assert.throws(() => getAuthConfig({}), /SUPABASE_ANON_KEY/);
    assert.throws(
      () => getAuthConfig({ SUPABASE_URL: "https://x.supabase.co" }),
      /SUPABASE_ANON_KEY/,
    );
    const config = getAuthConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
    });
    assert.equal(config.supabaseUrl, "https://example.supabase.co");
  });
});

describe("verifySession() — GoTrue is the verifier", () => {
  const config = getAuthConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
  });

  it("returns null for a missing or empty token without calling GoTrue", async () => {
    let calls = 0;
    const fetchStub = () => {
      calls += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "user-alice" }),
      });
    };
    assert.equal(await verifySession(null, config, fetchStub), null);
    assert.equal(await verifySession("", config, fetchStub), null);
    assert.equal(await verifySession("   ", config, fetchStub), null);
    assert.equal(calls, 0);
  });

  it("returns the user when GoTrue accepts the token, and null when it rejects it", async () => {
    const okFetch = (url: string, init?: { headers?: Record<string, string> }) => {
      assert.match(url, /\/auth\/v1\/user$/);
      assert.equal(init?.headers?.Authorization, "Bearer good-token");
      assert.equal(init?.headers?.apikey, "placeholder-not-a-real-key");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "user-alice",
            email: "alice@example.com",
            app_metadata: { provider: "email" },
          }),
      });
    };
    const user = await verifySession("good-token", config, okFetch);
    assert.deepEqual(user, {
      id: "user-alice",
      email: "alice@example.com",
      provider: "email",
    });

    const rejectedFetch = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: "expired" }),
      });
    assert.equal(await verifySession("bad-token", config, rejectedFetch), null);
  });

  it("returns null for a GoTrue body without a usable id, and throws only when GoTrue is unreachable", async () => {
    const noIdFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ email: "alice@example.com" }),
      });
    assert.equal(await verifySession("token", config, noIdFetch), null);

    const downFetch = (): Promise<never> => Promise.reject(new Error("network down"));
    await assert.rejects(
      () => verifySession("token", config, downFetch),
      (error: unknown) => {
        assert.ok(error instanceof AuthUnavailableError);
        assert.ok(!(error as Error).message.includes("token"));
        return true;
      },
    );
  });
});

describe("anonymous masking — RLS does not anonymise, this does", () => {
  it("masks author id, handle, and name to Anonymous, and never mutates the input", () => {
    const author = {
      authorId: "user-alice",
      handle: "alice",
      displayName: "Alice Example",
      initials: "AE",
    };
    const masked = maskAuthor(author, true);
    assert.deepEqual(masked, {
      authorId: null,
      handle: "Anonymous",
      displayName: "Anonymous",
      initials: "AN",
    });
    assert.equal(author.authorId, "user-alice", "input must not be mutated");
    const plain = maskAuthor(author, false);
    assert.deepEqual(plain, author);
    assert.notEqual(
      plain,
      author,
      "a new object must be returned even when not anonymous",
    );
  });

  it("maskOpinion masks only anonymous opinions", () => {
    const base = {
      id: "op-1",
      body: "Test opinion",
      topic: "Work",
      author: {
        authorId: "user-alice",
        handle: "alice",
        displayName: "Alice",
        initials: "A",
      },
    };
    assert.equal(maskOpinion({ ...base, isAnonymous: true }).author.authorId, null);
    assert.equal(maskOpinion({ ...base, isAnonymous: true }).author.handle, "Anonymous");
    assert.equal(
      maskOpinion({ ...base, isAnonymous: false }).author.authorId,
      "user-alice",
    );
  });

  it("initials are derived at render time, never from email", () => {
    assert.equal(initialsFor("Alice Example"), "AE");
    assert.equal(initialsFor("Alice"), "A");
    assert.equal(initialsFor("  "), "OP");
    assert.equal(initialsFor(""), "OP");
  });
});

describe("Layer 4 migration file — profile trigger", () => {
  it("defines the handle_new_user function and on_auth_user_created trigger", async () => {
    const sql = await readFile(
      join(
        import.meta.dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        "20261029050000_auth_profile_trigger.sql",
      ),
      "utf8",
    );
    assert.match(sql, /create or replace function public\.handle_new_user\(\)/);
    assert.match(sql, /security definer/);
    assert.match(sql, /on_auth_user_created/);
    assert.match(sql, /after insert on auth\.users/);
    assert.match(sql, /insert into public\.profiles/);
    assert.match(sql, /on conflict \(id\) do nothing/);
    assert.match(sql, /\^\[a-z0-9_\]\{3,30\}\$/);
    assert.match(sql, /user_/);
    // No media, billing, or secret content in the migration.
    assert.ok(!sql.includes("service_role") || sql.includes("never"));
  });
});

describe("health auth check (Layer 4 honesty rule)", () => {
  it("reports auth as not_configured when Supabase env vars are missing", () => {
    const env = loadEnv({ NODE_ENV: "test" });
    const health = buildHealth(env);
    assert.equal(health.checks.auth.status, "not_configured");
    assert.equal(health.checks.auth.configured, false);
  });

  it("never reports auth as ok in this layer, even when vars are present", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
    });
    const health = buildHealth(env);
    assert.equal(health.checks.auth.status, "not_checked");
    assert.notEqual(health.checks.auth.status, "ok" as never);
  });
});
