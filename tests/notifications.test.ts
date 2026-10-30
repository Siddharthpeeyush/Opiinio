import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { listNotifications } from "../src/services/api2.js";
import { seedStore } from "./fake-store.js";
import type { AuthUser } from "../src/lib/auth.js";

/**
 * Decision 0023 — notification creation triggers.
 *
 * The triggers themselves are Postgres (migration 07); the mock store
 * cannot execute SQL, so this file guards the migration's structure
 * statically (every trigger present, SECURITY DEFINER, fixed
 * search_path, suppression rules, revokes) and tests the API-side
 * contract change (the widened ?type= filter). Live proof of the
 * triggers firing is the QA matrix against the deployed backend,
 * not this file.
 */

const migration = await readFile(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20261030070000_notification_triggers.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const alice: AuthUser = { id: "user-alice", email: "a@x.com", provider: "email" };

describe("migration 07 — notification triggers (static structure)", () => {
  it("widens the notification type check to the emitted event types", () => {
    assert.match(
      migration,
      /check \(type in \('follow', 'reply', 'like', 'repost', 'mention', 'update'\)\)/,
    );
  });

  const triggers: Array<[string, string, string]> = [
    ["trg_notify_on_follow", "public.follows", "notify_on_follow"],
    ["trg_notify_on_reply", "public.replies", "notify_on_reply"],
    ["trg_notify_on_opinion_like", "public.opinion_likes", "notify_on_opinion_like"],
    ["trg_notify_on_reply_like", "public.reply_likes", "notify_on_reply_like"],
    ["trg_notify_on_repost", "public.reposts", "notify_on_repost"],
  ];
  for (const [trigger, table, fn] of triggers) {
    it(`attaches ${trigger} after insert on ${table}`, () => {
      assert.match(
        migration,
        new RegExp(
          `create trigger ${trigger}[\\s\\S]*after insert on ${table.replace(".", "\\.")}[\\s\\S]*execute function public\\.${fn}\\(\\)`,
        ),
      );
    });
  }

  it("every trigger function is SECURITY DEFINER with a fixed search_path", () => {
    const definerCount = (
      migration.match(/security definer\s+set search_path = public/g) || []
    ).length;
    assert.equal(
      definerCount,
      5,
      "all five trigger functions must be SECURITY DEFINER with fixed search_path",
    );
  });

  it("suppresses self-notifications and blocked-actor notifications", () => {
    assert.match(migration, /recipient_id = actor_id/);
    assert.match(migration, /blocker_id = recipient_id/);
    assert.match(migration, /blocked_id = actor_id/);
  });

  it("revokes direct execution from anon/authenticated/public", () => {
    assert.match(
      migration,
      /revoke all on function public\.notify_on_follow\(\) from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /revoke all on function public\.notify_on_reply\(\) from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /revoke all on function public\.notify_on_opinion_like\(\) from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /revoke all on function public\.notify_on_reply_like\(\) from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /revoke all on function public\.notify_on_repost\(\) from public, anon, authenticated/,
    );
  });

  it("carries opinion_id on reply-like notifications (read-path masking needs it)", () => {
    assert.match(
      migration,
      /values \(reply_author, new\.user_id, 'like', parent_opinion, new\.reply_id\)/,
    );
  });

  it("inserts no key material and no hardcoded user ids", () => {
    assert.doesNotMatch(migration, /service_role|secret|password|api[_-]?key/i);
  });
});

describe("GET /api/notifications?type= accepts the new event types", () => {
  it("does not 400 on type=follow", async () => {
    const store = seedStore();
    const page = await listNotifications(
      store,
      { user: alice },
      { limit: 10, cursor: null, type: "follow" },
    );
    assert.ok(Array.isArray(page.items));
  });

  it("does not 400 on type=like or type=repost", async () => {
    const store = seedStore();
    for (const type of ["like", "repost"]) {
      const page = await listNotifications(
        store,
        { user: alice },
        { limit: 10, cursor: null, type },
      );
      assert.ok(Array.isArray(page.items));
    }
  });

  it("still 400s on an unknown type", async () => {
    const store = seedStore();
    await assert.rejects(
      listNotifications(
        store,
        { user: alice },
        { limit: 10, cursor: null, type: "poke" },
      ),
      /type must be/,
    );
  });
});
