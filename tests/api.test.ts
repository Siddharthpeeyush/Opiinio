import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AuthUser } from "../src/lib/auth.js";
import { ApiError } from "../src/lib/http.js";
import * as api from "../src/services/api.js";
import * as api2 from "../src/services/api2.js";
import { StoreError } from "../src/db/store.js";
import { FakeStore, seedStore } from "./fake-store.js";

/**
 * Layer 5 API tests — service logic against a labelled in-memory
 * fake store. These prove auth gating, can(), validation, and
 * serialisation. They do NOT prove live RLS or live PostgREST
 * behaviour (AUTH-SETUP-GUIDE.md §5 is the live proof, pending
 * two real users), and they never contact a live Supabase project.
 */

const alice: AuthUser = {
  id: "user-alice",
  email: "alice@example.com",
  provider: "email",
};
const bob: AuthUser = { id: "user-bob", email: "bob@example.com", provider: "google" };

function statusOf(error: unknown): number {
  assert.ok(error instanceof ApiError, "expected an ApiError");
  return error.status;
}

describe("auth-first: writes require a verified session", () => {
  it("unauthenticated createOpinion is 401", async () => {
    const store = seedStore();
    await assert.rejects(
      api.createOpinion(store, { user: null }, { body: "Hello", topic: "Money" }),
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it("unauthenticated bookmark list is 401", async () => {
    const store = seedStore();
    await assert.rejects(
      api2.listBookmarks(store, { user: null }, { limit: 20, cursor: null }),
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it("a forged author_id in the body is rejected, not trusted", async () => {
    const store = seedStore();
    // The body claims bob, but the verified caller is alice: the
    // unknown key must be rejected outright (400), and even if it
    // were ignored, the row's author would be the caller, not bob.
    await assert.rejects(
      api.createOpinion(store, { user: alice }, {
        body: "Forged",
        topic: "Money",
        author_id: "user-bob",
      } as unknown as api.OpinionInput),
      (error: unknown) => statusOf(error) === 400,
    );
  });

  it("a created opinion's author is the verified caller, never the body", async () => {
    const store = seedStore();
    const created = await api.createOpinion(
      store,
      { user: alice },
      {
        body: "My take",
        topic: "Money",
      },
    );
    assert.equal(created.author.authorId, "user-alice");
    assert.equal(created.author.handle, "alice");
  });
});

describe("can() gating and 401/403/404 mapping", () => {
  it("other user's public opinion cannot be edited: 403", async () => {
    const store = seedStore();
    await assert.rejects(
      api.updateOpinion(store, { user: alice }, "op-bob", { body: "Hacked" }),
      (error: unknown) => statusOf(error) === 403,
    );
  });

  it("own opinion can be edited; is_anonymous cannot be flipped", async () => {
    const store = seedStore();
    const updated = await api.updateOpinion(store, { user: bob }, "op-bob", {
      body: "Edited take",
    });
    assert.equal(updated.body, "Edited take");
    await assert.rejects(
      api.updateOpinion(store, { user: bob }, "op-bob", { is_anonymous: true }),
      (error: unknown) => statusOf(error) === 400,
    );
  });

  it("other user's private report is 404, not 403 and not data", async () => {
    const store = seedStore();
    const report = await api2.createReport(
      store,
      { user: alice },
      {
        opinion_id: "op-bob",
        reason: "Spam",
      },
    );
    await assert.rejects(
      api2.getReport(store, { user: bob }, report.id),
      (error: unknown) => statusOf(error) === 404,
    );
    // Own report reads fine.
    const own = await api2.getReport(store, { user: alice }, report.id);
    assert.equal(own.id, report.id);
  });

  it("visitors may read public opinions but may not vote", async () => {
    const store = seedStore();
    const opinion = await api.getOpinion(store, { user: null }, "op-bob");
    assert.equal(opinion.body, "Public take on tech");
    await assert.rejects(
      api.setStance(store, { user: null }, "op-bob", "agree"),
      (error: unknown) => statusOf(error) === 401,
    );
  });
});

describe("validation", () => {
  it("281 characters rejected", async () => {
    const store = seedStore();
    await assert.rejects(
      api.createOpinion(
        store,
        { user: alice },
        {
          body: "x".repeat(281),
          topic: "Money",
        },
      ),
      (error: unknown) => statusOf(error) === 400,
    );
  });

  it("topic over 50 characters rejected", async () => {
    const store = seedStore();
    await assert.rejects(
      api.createOpinion(
        store,
        { user: alice },
        {
          body: "Fine",
          topic: "t".repeat(51),
        },
      ),
      (error: unknown) => statusOf(error) === 400,
    );
  });

  it("self-follow and self-block rejected", async () => {
    const store = seedStore();
    await assert.rejects(
      api2.follow(store, { user: alice }, "user-alice"),
      (error: unknown) => statusOf(error) === 400,
    );
    await assert.rejects(
      api2.block(store, { user: alice }, "user-alice"),
      (error: unknown) => statusOf(error) === 400,
    );
  });

  it("poll option from another poll rejected", async () => {
    const store = seedStore();
    const pollA = await api2.createPoll(store, { user: bob }, "op-bob", {
      options: ["Yes", "No"],
    });
    const pollB = await api2.createPoll(store, { user: alice }, "op-anon", {
      options: ["A", "B"],
    });
    const foreignOption = pollB.options[0]?.id as string;
    await assert.rejects(
      api2.castPollVote(store, { user: alice }, pollA.id, foreignOption),
      (error: unknown) => statusOf(error) === 400,
    );
  });

  it("report must target exactly one of opinion/reply", async () => {
    const store = seedStore();
    await assert.rejects(
      api2.createReport(store, { user: alice }, { reason: "Spam" }),
      (error: unknown) => statusOf(error) === 400,
    );
    await assert.rejects(
      api2.createReport(
        store,
        { user: alice },
        {
          opinion_id: "op-bob",
          reply_id: "reply-1",
          reason: "Spam",
        },
      ),
      (error: unknown) => statusOf(error) === 400,
    );
  });
});

describe("votes, likes, reposts, polls — idempotency and locking", () => {
  it("stance can change; poll vote is locked until undone", async () => {
    const store = seedStore();
    const first = await api.setStance(store, { user: alice }, "op-bob", "agree");
    assert.equal(first.stance, "agree");
    const changed = await api.setStance(store, { user: alice }, "op-bob", "disagree");
    assert.equal(changed.stance, "disagree");

    const poll = await api2.createPoll(store, { user: bob }, "op-bob", {
      options: ["Yes", "No"],
    });
    await api2.castPollVote(
      store,
      { user: alice },
      poll.id,
      poll.options[0]?.id as string,
    );
    await assert.rejects(
      api2.castPollVote(store, { user: alice }, poll.id, poll.options[1]?.id as string),
      (error: unknown) => statusOf(error) === 409,
    );
    await api2.undoPollVote(store, { user: alice }, poll.id);
    const revote = await api2.castPollVote(
      store,
      { user: alice },
      poll.id,
      poll.options[1]?.id as string,
    );
    assert.equal(revote.ownOptionId, poll.options[1]?.id);
  });

  it("second like and second repost are 409, not duplicates", async () => {
    const store = seedStore();
    await api.likeOpinion(store, { user: alice }, "op-bob");
    await assert.rejects(
      api.likeOpinion(store, { user: alice }, "op-bob"),
      (error: unknown) => statusOf(error) === 409,
    );
    await api.createRepost(store, { user: alice }, "op-bob", {});
    await assert.rejects(
      api.createRepost(store, { user: alice }, "op-bob", {}),
      (error: unknown) => statusOf(error) === 409,
    );
  });

  it("quote repost over 280 characters rejected", async () => {
    const store = seedStore();
    await assert.rejects(
      api.createRepost(store, { user: alice }, "op-bob", { quote_take: "x".repeat(281) }),
      (error: unknown) => statusOf(error) === 400,
    );
  });
});

describe("server-only tables and pagination", () => {
  it("notification creation is a stubbed 403, never a row", () => {
    assert.throws(
      () => api2.createNotificationServerOnly(),
      (error: unknown) => statusOf(error) === 403,
    );
  });

  it("daily questions are read-only: no create function is exported for users", () => {
    // Compile-time proof by construction: api2 exports only
    // listDailyQuestions / getDailyQuestion for daily questions.
    const names = Object.keys(api2);
    assert.ok(!names.includes("createDailyQuestion"));
    assert.ok(names.includes("listDailyQuestions"));
  });

  it("limit is capped at 50", async () => {
    const store = seedStore();
    const page = await api.listOpinions(
      store,
      { user: null },
      {
        limit: 500,
        cursor: null,
      },
    );
    assert.ok(page.items.length <= 50);
  });

  it("cursor pages forward without repeating rows", async () => {
    const store = new FakeStore({
      opinions: Array.from({ length: 5 }, (_, i) => ({
        id: `op-${i}`,
        author_id: "user-bob",
        body: `Take ${i}`,
        topic: "Money",
        is_anonymous: false,
        daily_question_id: null,
        agree_count: 0,
        neutral_count: 0,
        disagree_count: 0,
        like_count: 0,
        repost_count: 0,
        reply_count: 0,
        created_at: `2026-10-0${i + 1}T00:00:00.000Z`,
      })),
      profiles: [
        {
          id: "user-bob",
          handle: "bob",
          display_name: "Bob B",
          bio: null,
          follower_count: 0,
          following_count: 0,
          pinned_opinion_id: null,
          created_at: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    const first = await api.listOpinions(
      store,
      { user: null },
      { limit: 2, cursor: null },
    );
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor !== null);
    const { decodeCursor } = await import("../src/lib/pagination.js");
    const second = await api.listOpinions(
      store,
      { user: null },
      {
        limit: 2,
        cursor: decodeCursor(first.nextCursor),
      },
    );
    const firstIds = new Set(first.items.map((item) => item.id));
    for (const item of second.items) {
      assert.ok(!firstIds.has(item.id), "page 2 must not repeat page 1");
    }
  });

  it("notifications mark-read rejects any other field", async () => {
    const store = seedStore();
    const note = await (async () => {
      // Seed a notification directly in the fake store (server-only
      // creation path is stubbed, so tests seed rows directly).
      const row = await store.insert("notifications", {
        user_id: "user-alice",
        actor_id: "user-bob",
        type: "reply",
        opinion_id: "op-bob",
        reply_id: null,
        is_read: false,
      });
      return row;
    })();
    await assert.rejects(
      api2.markNotificationRead(store, { user: alice }, String(note.id), {
        is_read: false,
      }),
      (error: unknown) => statusOf(error) === 400,
    );
    await assert.rejects(
      api2.markNotificationRead(store, { user: alice }, String(note.id), {
        is_read: true,
        type: "mention",
      }),
      (error: unknown) => statusOf(error) === 400,
    );
    const marked = await api2.markNotificationRead(
      store,
      { user: alice },
      String(note.id),
      {
        is_read: true,
      },
    );
    assert.equal(marked.isRead, true);
  });
});

describe("store failure mapping (decision 0020 follow-up)", () => {
  it("listOpinions maps a rejected service key (401) to 503, never 500", async () => {
    // Regression test for the live incident: PostgREST rejected our
    // service key with 401, StoreError propagated unmapped, and the
    // API answered cryptic 500 INTERNAL_ERROR. A rejected service
    // key is a server misconfiguration -> generic 503.
    class RejectedKeyStore extends FakeStore {
      override list(): Promise<never> {
        return Promise.reject(new StoreError(401));
      }
    }
    const store = new RejectedKeyStore();
    await assert.rejects(
      api.listOpinions(store, { user: null }, { limit: 20, cursor: null }),
      (error: unknown) => statusOf(error) === 503,
    );
  });
});
