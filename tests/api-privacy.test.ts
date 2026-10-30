import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuthUser } from "../src/lib/auth.js";
import { corsHeaders } from "../src/lib/cors.js";
import { parseLimit } from "../src/lib/pagination.js";
import { COLUMNS, RestStore, eqFilter } from "../src/db/store.js";
import * as api from "../src/services/api.js";
import * as api2 from "../src/services/api2.js";
import { notificationView, opinionView } from "../src/services/serializers.js";
import { handleApi } from "../src/routes/api.js";
import { seedStore } from "./fake-store.js";

/**
 * Layer 5 privacy tests — every rule from the user's "privacy in
 * every aspect" instruction, tested, not asserted in prose:
 * anonymous leak (including nested quote), private-table cross-user,
 * voter privacy, generic errors, secret grep, CORS non-wildcard,
 * hidden-API routes, and no personal data in responses.
 * Store is the labelled fake; live proof is still AUTH-SETUP-GUIDE §5.
 */

const alice: AuthUser = {
  id: "user-alice",
  email: "alice@example.com",
  provider: "email",
};
const bob: AuthUser = { id: "user-bob", email: "bob@example.com", provider: "google" };

describe("anonymous masking — leak test", () => {
  it("serialised anonymous opinion contains no real author id or handle anywhere", async () => {
    const store = seedStore();
    // Even when the real author row is handed to the serializer,
    // an anonymous opinion must not leak it.
    const row = (await store.get("opinions", "op-anon")) as Record<string, unknown>;
    const authorRow = (await store.get("profiles", "user-alice")) as Record<
      string,
      unknown
    >;
    const view = opinionView(row, authorRow, { stance: null, liked: false });
    const serialised = JSON.stringify(view);
    assert.equal(view.author.authorId, null);
    assert.equal(view.author.handle, "Anonymous");
    assert.equal(view.author.displayName, "Anonymous");
    assert.equal(view.author.initials, "AN");
    assert.ok(!serialised.includes("user-alice"), "author id leaked");
    assert.ok(!serialised.includes('"alice"'), "handle leaked");
    assert.ok(!serialised.includes("Alice A"), "display name leaked");
    assert.ok(!serialised.includes("alice@example.com"), "email leaked");
  });

  it("nested quote of an anonymous opinion is masked too", async () => {
    const store = seedStore();
    const repost = await api.createRepost(store, { user: bob }, "op-anon", {
      quote_take: "Exactly this.",
    });
    const serialised = JSON.stringify(repost);
    assert.ok(repost.original !== null);
    assert.equal(repost.original?.author.authorId, null);
    assert.equal(repost.original?.author.handle, "Anonymous");
    assert.ok(!serialised.includes("user-alice"), "quoted author id leaked");
    assert.ok(!serialised.includes("Alice A"), "quoted display name leaked");
    // The reposter (bob, a public repost) IS shown — that is his
    // own public action, not the anonymous author's identity.
    assert.equal(repost.repostedBy?.handle, "bob");
  });

  it("anonymous opinion in a list is masked for everyone, including its author", async () => {
    const store = seedStore();
    const page = await api.listOpinions(
      store,
      { user: alice },
      { limit: 20, cursor: null },
    );
    const anon = page.items.find((item) => item.id === "op-anon");
    assert.ok(anon !== undefined);
    assert.equal(anon.author.authorId, null);
    assert.equal(anon.author.handle, "Anonymous");
  });

  it("notification for an anonymous opinion masks its actor", async () => {
    const store = seedStore();
    const row = await store.insert("notifications", {
      user_id: "user-bob",
      actor_id: "user-alice",
      type: "reply",
      opinion_id: "op-anon",
      reply_id: null,
      is_read: false,
    });
    const page = await api2.listNotifications(
      store,
      { user: bob },
      { limit: 20, cursor: null },
    );
    const note = page.items.find((item) => item.id === String(row.id));
    assert.ok(note !== undefined);
    assert.equal(note.actor?.authorId, null);
    assert.equal(note.actor?.handle, "Anonymous");
    assert.ok(!JSON.stringify(note).includes("user-alice"));
  });
});

describe("private tables are own-only", () => {
  it("bob cannot list alice's bookmarks, mutes, blocks, or reports", async () => {
    const store = seedStore();
    await api2.bookmark(store, { user: alice }, "op-bob");
    await api2.muteTopic(store, { user: alice }, "Money");
    await api2.block(store, { user: alice }, "user-bob");
    await api2.createReport(
      store,
      { user: alice },
      { opinion_id: "op-bob", reason: "Spam" },
    );

    const bobBookmarks = await api2.listBookmarks(
      store,
      { user: bob },
      { limit: 20, cursor: null },
    );
    assert.equal(bobBookmarks.items.length, 0);
    const bobMutes = await api2.listMutedTopics(
      store,
      { user: bob },
      { limit: 20, cursor: null },
    );
    assert.equal(bobMutes.items.length, 0);
    const bobBlocks = await api2.listBlocks(
      store,
      { user: bob },
      { limit: 20, cursor: null },
    );
    assert.equal(bobBlocks.items.length, 0);
    const bobReports = await api2.listReports(
      store,
      { user: bob },
      { limit: 20, cursor: null },
    );
    assert.equal(bobReports.items.length, 0);

    const aliceBookmarks = await api2.listBookmarks(
      store,
      { user: alice },
      { limit: 20, cursor: null },
    );
    assert.equal(aliceBookmarks.items.length, 1);
  });

  it("private views contain no other user's data and no email", async () => {
    const store = seedStore();
    await api2.bookmark(store, { user: alice }, "op-bob");
    const page = await api2.listBookmarks(
      store,
      { user: alice },
      { limit: 20, cursor: null },
    );
    const serialised = JSON.stringify(page);
    assert.ok(!serialised.includes("user-bob"), "bookmark list leaked another user");
    assert.ok(!serialised.includes("@example.com"), "email leaked in private view");
  });
});

describe("vote privacy", () => {
  it("another user sees aggregates only, never my stance or like", async () => {
    const store = seedStore();
    await api.setStance(store, { user: alice }, "op-bob", "agree");
    await api.likeOpinion(store, { user: alice }, "op-bob");
    const asBob = await api.getOpinion(store, { user: bob }, "op-bob");
    assert.equal(asBob.ownStance, null);
    assert.equal(asBob.ownLiked, false);
    assert.ok(!JSON.stringify(asBob).includes("user-alice"));
    const asAlice = await api.getOpinion(store, { user: alice }, "op-bob");
    assert.equal(asAlice.ownStance, "agree");
    assert.equal(asAlice.ownLiked, true);
  });

  it("poll view shows counts and only my own option", async () => {
    const store = seedStore();
    const poll = await api2.createPoll(store, { user: bob }, "op-bob", {
      options: ["Yes", "No"],
    });
    await api2.castPollVote(
      store,
      { user: alice },
      poll.id,
      poll.options[0]?.id as string,
    );
    const asBob = await api2.getPollByOpinion(store, { user: bob }, "op-bob");
    assert.equal(asBob.ownOptionId, null);
    assert.ok(!JSON.stringify(asBob).includes("user-alice"));
    const asAlice = await api2.getPollByOpinion(store, { user: alice }, "op-bob");
    assert.equal(asAlice.ownOptionId, poll.options[0]?.id);
  });
});

describe("no personal data in public responses", () => {
  it("public profile has no email, phone, or token fields", async () => {
    const store = seedStore();
    const profile = await api.getProfile(store, { user: null }, "user-alice");
    const serialised = JSON.stringify(profile);
    assert.ok(!serialised.includes("alice@example.com"));
    assert.ok(!serialised.includes("token"));
    assert.ok(!("email" in profile));
    assert.equal(profile.handle, "alice");
    assert.equal(profile.initials, "AA");
  });
});

describe("generic errors, CORS, hidden API", () => {
  it("a malformed id is a generic 400 with no internal detail", async () => {
    const result = await handleApi("GET", "/api/opinions/not-a-uuid", {}, null, {
      verify: () => Promise.resolve(null),
      store: () => seedStore(),
    });
    assert.equal(result.statusCode, 400);
    assert.ok(!result.body.includes("uuid"));
    assert.ok(!result.body.includes("requireUuid"));
    assert.ok(!result.body.includes("/home/"));
  });

  it("an unexpected throw through the HTTP layer is a generic 500", async () => {
    const result = await handleApi(
      "GET",
      "/api/opinions/123e4567-e89b-12d3-a456-426614174000",
      {},
      null,
      {
        verify: () => Promise.resolve(null),
        store: () => ({
          get: () => Promise.reject(new Error("relation does not exist: secret_table")),
          getBy: () => Promise.resolve(null),
          list: () => Promise.resolve({ rows: [], nextCursor: null }),
          insert: () => Promise.resolve({}),
          update: () => Promise.resolve(null),
          remove: () => Promise.resolve(true),
          removeBy: () => Promise.resolve(true),
        }),
      },
    );
    assert.equal(result.statusCode, 500);
    assert.equal(
      result.body,
      JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }),
    );
  });

  it("CORS never returns a wildcard and refuses foreign origins", () => {
    assert.deepEqual(corsHeaders("https://evil.example", undefined), null);
    const ok = corsHeaders("http://localhost:3000", undefined);
    assert.ok(ok !== null);
    assert.equal(ok["access-control-allow-origin"], "http://localhost:3000");
    assert.ok(!Object.values(ok).includes("*"));
  });

  it("hidden-API routes return generic 404: docs, spec, listing, profile list", async () => {
    const deps = {
      verify: () => Promise.resolve(null),
      store: () => seedStore(),
    };
    for (const path of [
      "/api/docs",
      "/api/openapi.json",
      "/api/routes",
      "/api/profiles",
      "/api/opinions/123e4567-e89b-12d3-a456-426614174000/votes",
    ]) {
      const result = await handleApi("GET", path, {}, null, deps);
      assert.equal(result.statusCode, 404, path);
      assert.ok(!result.body.includes("opinion_votes"));
    }
    // POST to a server-only table is also a plain 404, not a 403
    // that would confirm the route exists.
    const postNotes = await handleApi("POST", "/api/notifications", {}, "{}", deps);
    assert.equal(postNotes.statusCode, 404);
  });

  it("unknown paths 404 before any auth or store setup (no env, no deps)", async () => {
    // Regression test for a live-proof finding: /api/docs used to
    // return 503 when Supabase env was missing, because dispatch
    // built the store before checking the route. Route matching
    // now runs first, so probing a hidden path always gets 404.
    const result = await handleApi("GET", "/api/docs", {}, null, {});
    assert.equal(result.statusCode, 404);
    assert.equal(
      result.body,
      JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }),
    );
  });

  it("HTTP responses carry security headers and no X-Powered-By", async () => {
    const result = await handleApi("GET", "/api/daily-questions", {}, null, {
      verify: () => Promise.resolve(null),
      store: () => seedStore(),
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.equal(result.headers["x-frame-options"], "DENY");
    assert.equal(result.headers["cache-control"], "no-store");
    assert.ok(!("x-powered-by" in result.headers));
  });

  it("a foreign Origin on a real route is refused with 403 and no CORS headers", async () => {
    const result = await handleApi(
      "GET",
      "/api/daily-questions",
      { origin: "https://evil.example" },
      null,
      { verify: () => Promise.resolve(null), store: () => seedStore() },
    );
    assert.equal(result.statusCode, 403);
    assert.ok(!("access-control-allow-origin" in result.headers));
  });

  it("pagination limit is capped even at the HTTP layer", () => {
    assert.equal(parseLimit("500"), 50);
    assert.equal(parseLimit(null), 20);
  });
});

describe("secrets and data minimisation (source checks)", () => {
  it("no SELECT * and no service_role key in the API/store source", async () => {
    const root = join(import.meta.dirname, "..", "..");
    const files = [
      "src/services/api.ts",
      "src/services/api2.ts",
      "src/services/serializers.ts",
      "src/db/store.ts",
      "src/routes/api.ts",
    ];
    for (const file of files) {
      const text = await readFile(join(root, file), "utf8");
      assert.ok(!text.includes("select *"), `${file} contains SELECT *`);
      assert.ok(!text.includes("SELECT *"), `${file} contains SELECT *`);
      // The only allowed mention is the warning telling editors
      // never to paste a service_role key (store.ts header).
      const mentions = text.match(/service_role/g) ?? [];
      if (file !== "src/db/store.ts") {
        assert.equal(mentions.length, 0, `${file} mentions service_role`);
      }
    }
  });

  it("every table's column list is explicit (no star in COLUMNS)", () => {
    for (const columns of Object.values(COLUMNS)) {
      assert.ok(!columns.includes("*"));
    }
    assert.equal(Object.keys(COLUMNS).length, 18);
  });

  it("RestStore sends the anon key + caller token, never a service key, and names columns", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const store = new RestStore(
      {
        supabaseUrl: "https://example.supabase.co",
        anonKey: "placeholder-not-a-real-key",
      },
      "caller-token-123",
      ((url: string, init?: { headers?: Record<string, string> }) => {
        seen.push({ url, headers: init?.headers ?? {} });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        });
      }) as never,
    );
    await store.get("profiles", "user-alice");
    assert.equal(seen.length, 1);
    const first = seen[0] as { url: string; headers: Record<string, string> };
    assert.ok(first.url.includes("select=id%2Chandle"));
    assert.equal(first.headers.apikey, "placeholder-not-a-real-key");
    assert.equal(first.headers.Authorization, "Bearer caller-token-123");
    assert.ok(!first.url.includes("*"));
    assert.ok(!JSON.stringify(first.headers).includes("service_role"));
  });

  it("notification serializer masks the actor when flagged anonymous", () => {
    const view = notificationView(
      {
        id: "n-1",
        type: "reply",
        opinion_id: "op-anon",
        reply_id: null,
        is_read: false,
        actor_id: "user-alice",
        created_at: "2026-10-29T00:00:00.000Z",
      },
      {
        id: "user-alice",
        handle: "alice",
        display_name: "Alice A",
      },
      true,
    );
    assert.equal(view.actor?.authorId, null);
    assert.equal(view.actor?.handle, "Anonymous");
    assert.ok(!JSON.stringify(view).includes("user-alice"));
  });

  it("RestStore cursor filter pages on (created_at, id)", async () => {
    const seen: string[] = [];
    const store = new RestStore(
      {
        supabaseUrl: "https://example.supabase.co",
        anonKey: "placeholder-not-a-real-key",
      },
      null,
      ((url: string) => {
        seen.push(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        });
      }) as never,
    );
    await store.list("opinions", {
      filters: [eqFilter("topic", "Money")],
      cursor: { createdAt: "2026-10-02T00:00:00.000Z", id: "op-anon" },
      limit: 20,
    });
    const url = seen[0] as string;
    assert.ok(url.includes("or=(created_at.lt."));
    assert.ok(url.includes("id.lt."));
    assert.ok(url.includes("limit=21"));
  });

  it("RestStore removeBy tolerates PostgREST 204 with an empty body", async () => {
    // Live bug 2026-10-30: every unlike/unvote/unfollow/delete 500ed
    // because call() ran response.json() on the empty 204 body and the
    // SyntaxError surfaced as INTERNAL_ERROR. The mock store never
    // reproduced it.
    const store = new RestStore(
      {
        supabaseUrl: "https://example.supabase.co",
        anonKey: "placeholder-not-a-real-key",
      },
      "caller-token-123",
      (() =>
        Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
        })) as never,
    );
    const removed = await store.removeBy("opinion_likes", [
      eqFilter("user_id", "user-alice"),
      eqFilter("opinion_id", "op-1"),
    ]);
    assert.equal(removed, true);
  });

  it("RestStore list on composite-key tables never orders or pages by id", async () => {
    // Live bug 2026-10-30: GET /bookmarks 500ed because list() always
    // appended id.desc, but bookmarks/muted_*/blocks/follows have no id
    // column (PostgREST 400).
    for (const table of ["bookmarks", "muted_topics", "muted_words", "blocks"]) {
      const seen: string[] = [];
      const store = new RestStore(
        {
          supabaseUrl: "https://example.supabase.co",
          anonKey: "placeholder-not-a-real-key",
        },
        null,
        ((url: string) => {
          seen.push(url);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([]),
          });
        }) as never,
      );
      await store.list(table, {
        filters: [eqFilter("user_id", "user-alice")],
        cursor: { createdAt: "2026-10-02T00:00:00.000Z", id: "" },
        limit: 20,
      });
      const url = seen[0] as string;
      assert.ok(!url.includes("id.desc"), `${table}: ${url}`);
      assert.ok(!url.includes("id.lt."), `${table}: ${url}`);
      assert.ok(url.includes("order=created_at.desc"), `${table}: ${url}`);
      assert.ok(url.includes("created_at.lt."), `${table}: ${url}`);
    }
  });
});
