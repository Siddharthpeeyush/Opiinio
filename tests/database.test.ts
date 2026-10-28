import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildHealth } from "../src/services/healthService.js";
import { loadEnv } from "../src/lib/env.js";

/**
 * Layer 3 cross-user / schema proof tests.
 *
 * These tests read the ACTUAL migration files in
 * supabase/migrations/ — they do not mock a database, and they do
 * not connect to a live Supabase project (no key has been shared,
 * and no live write is part of this layer). What they prove:
 * every V1 table exists, RLS is enabled on it, it has at least one
 * policy, 280-char checks exist, self-follow is blocked, and the
 * composite primary keys exist. A test that only asserted on a mock
 * would still pass if a migration were deleted; these fail if a
 * migration file, table, policy, or check is removed.
 *
 * What they do NOT prove (honest limit, see MIGRATION-GUIDE.md):
 * that the SQL runs cleanly on a live Postgres, or that RLS blocks
 * a real second user. That proof requires the user to apply the
 * migrations in the Supabase SQL Editor and run the seed
 * verification queries there — a live-database step, not a file
 * step, and it is listed as skipped in the Layer 3 report.
 */

// Tests run from dist/tests/ (see package.json: build then
// node --test dist/tests/*.test.js), so the repo root is TWO levels
// up from import.meta.dirname — the same dist-layout rule as
// src/app.ts's PUBLIC_DIR. Using ".." here was the bug that made
// the first test run fail with ENOENT on dist/supabase/.
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "supabase", "migrations");

async function readMigrations(): Promise<{
  core: string;
  rls: string;
  all: string;
}> {
  const files = (await readdir(MIGRATIONS_DIR)).sort();
  assert.ok(files.length >= 4, `expected >= 4 migration files, got ${files.length}`);
  const texts: string[] = [];
  for (const file of files) {
    assert.match(file, /\.sql$/, `migration file must end in .sql: ${file}`);
    texts.push(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
  }
  const core = texts.find((t) => t.includes("core tables")) ?? "";
  const rls = texts.find((t) => t.includes("Row Level Security")) ?? "";
  assert.ok(core.length > 0, "core-tables migration not found");
  assert.ok(rls.length > 0, "RLS migration not found");
  return { core, rls, all: texts.join("\n") };
}

function tableNames(sql: string): string[] {
  const names: string[] = [];
  const re = /create table if not exists public\.(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names;
}

const EXPECTED_TABLES = [
  "profiles",
  "daily_questions",
  "opinions",
  "replies",
  "opinion_votes",
  "opinion_likes",
  "reply_likes",
  "reposts",
  "follows",
  "polls",
  "poll_options",
  "poll_votes",
  "bookmarks",
  "muted_topics",
  "muted_words",
  "blocks",
  "reports",
  "notifications",
];

const BANNED_TABLE_NAMES = [
  "media",
  "photos",
  "videos",
  "uploads",
  "files",
  "subscriptions",
  "payments",
  "invoices",
];

describe("Layer 3 migrations (files, not a live database)", () => {
  it("defines all 18 V1 tables and no media or billing table", async () => {
    const { core } = await readMigrations();
    const names = tableNames(core);
    for (const table of EXPECTED_TABLES) {
      assert.ok(names.includes(table), `missing table: ${table}`);
    }
    for (const banned of BANNED_TABLE_NAMES) {
      assert.ok(!names.includes(banned), `banned table present: ${banned}`);
    }
  });

  it("enables RLS on every V1 table and defines at least one policy per table", async () => {
    const { rls } = await readMigrations();
    for (const table of EXPECTED_TABLES) {
      assert.match(
        rls,
        new RegExp(`enable row level security`, "i"),
        `RLS not enabled (migration must contain the enable statement)`,
      );
      // The enable statement is a single DO loop over a literal list;
      // assert the table is named in that list, and that a policy
      // exists naming it.
      assert.ok(rls.includes(`'${table}'`), `table ${table} not in the RLS enable list`);
      assert.ok(rls.includes(`on public.${table}`), `no policy found for table ${table}`);
    }
  });

  it("enforces the 280-character limit in the database, not just in UI code", async () => {
    const { core } = await readMigrations();
    for (const fragment of [
      "char_length(body) between 1 and 280",
      "char_length(quote_take) between 1 and 280",
      "char_length(bio) <= 280",
      "char_length(question) between 1 and 280",
      "char_length(reason) between 1 and 280",
    ]) {
      assert.ok(core.includes(fragment), `missing 280-char check: ${fragment}`);
    }
  });

  it("blocks self-follow and self-block, and enforces one-vote-per-user keys", async () => {
    const { core } = await readMigrations();
    assert.ok(
      core.includes("check (follower_id <> following_id)"),
      "self-follow check missing on follows",
    );
    assert.ok(
      core.includes("check (blocker_id <> blocked_id)"),
      "self-block check missing on blocks",
    );
    for (const key of [
      "primary key (follower_id, following_id)",
      "primary key (user_id, opinion_id)",
      "primary key (user_id, poll_id)",
      "primary key (user_id, reply_id)",
    ]) {
      assert.ok(core.includes(key), `missing composite key: ${key}`);
    }
    assert.ok(
      core.includes("unique (user_id, opinion_id)"),
      "one repost per user per opinion not enforced",
    );
  });

  it("has follow-count, vote-count, and block-removes-follow triggers", async () => {
    const { all } = await readMigrations();
    for (const trigger of [
      "sync_follow_counts",
      "sync_opinion_vote_counts",
      "sync_opinion_like_count",
      "sync_opinion_repost_count",
      "sync_opinion_reply_count",
      "sync_poll_option_vote_count",
      "sync_reply_voice_score",
      "remove_follows_on_block",
    ]) {
      assert.ok(all.includes(trigger), `missing trigger: ${trigger}`);
    }
  });

  it("has no live-database dependency: the seed file requires real auth UUIDs", async () => {
    const seed = await readFile(
      join(import.meta.dirname, "..", "..", "supabase", "seed.sql"),
      "utf8",
    );
    assert.match(seed, /SEED ONLY/);
    assert.match(seed, /USER_A_ID/);
    assert.match(seed, /USER_B_ID/);
  });
});

describe("health database check (Layer 3 honesty rule)", () => {
  it("reports database as not_configured when Supabase env vars are missing", () => {
    const env = loadEnv({ NODE_ENV: "test" });
    const health = buildHealth(env);
    assert.equal(health.checks.database.status, "not_configured");
    assert.equal(health.checks.database.configured, false);
    assert.equal(health.checks.database.timeoutMs, 3000);
  });

  it("never reports database as ok in this layer, even when vars are present", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
    });
    const health = buildHealth(env);
    assert.equal(health.checks.database.configured, true);
    assert.equal(health.checks.database.status, "not_checked");
    assert.notEqual(
      health.checks.database.status,
      "ok" as never,
      "a fake ok database check would hide an unwired client",
    );
  });
});
