import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Live-list pass tests — static + served-page checks, same pattern
 * as tests/frontend.test.ts. These tests do NOT run a browser and
 * do NOT claim a visual check or a live Supabase call: there is no
 * key, providers are not enabled live, and migration 05 is not
 * applied live. They prove the shipped frontend code fetches live
 * lists through same-origin /api/* only, renders live data ahead
 * of sample data, handles 401/503 by the stated contract, and
 * de-duplicates paged lists by id. A live visual screenshot pass
 * is still owed before launch — see docs/decisions/0012.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const PUBLIC = join(ROOT, "public");

async function readPublic(name: string): Promise<string> {
  return readFile(join(PUBLIC, name), "utf8");
}

function sliceFunction(js: string, name: string, next: string): string {
  const start = js.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `missing function ${name}`);
  const end = js.indexOf(`function ${next}(`, start + 1);
  return end === -1 ? js.slice(start) : js.slice(start, end);
}

describe("live lists fetch through /api only, with Bearer", () => {
  it("the only fetch helper sends a Bearer token from session state", async () => {
    const js = await readPublic("app.js");
    assert.match(js, /Authorization.*Bearer.*state\.token/);
    const fetchCalls = js.match(/fetch\([^)]*\)/g) ?? [];
    assert.ok(fetchCalls.length > 0, "expected at least one fetch call");
    for (const call of fetchCalls) {
      assert.match(call, /"\/api"/, `non-/api fetch found: ${call}`);
      assert.doesNotMatch(call, /https?:/);
    }
    assert.doesNotMatch(js, /https:\/\//);
  });

  it("feed, notifications, and own profile call the Layer 5 endpoints", async () => {
    const js = await readPublic("app.js");
    for (const marker of [
      "loadLiveFeed",
      "loadLiveNotifications",
      "loadLiveProfile",
      "loadLivePost",
      "loadLiveDaily",
      '"/opinions?limit=20"',
      '"/notifications?limit=20"',
      '"/profiles/"',
      '"/bookmarks?limit=20"',
      '"/daily-questions?limit=20"',
    ]) {
      assert.ok(js.includes(marker), `missing live-list marker: ${marker}`);
    }
  });

  it("live data renders ahead of sample data in feed, notifications, and profile", async () => {
    const js = await readPublic("app.js");
    const feed = sliceFunction(js, "screenFeed", "screenCompose");
    assert.ok(
      feed.indexOf("liveFeedItems") !== -1 &&
        feed.indexOf("liveFeedItems") < feed.indexOf("SAMPLE_OPINIONS"),
      "screenFeed must render liveFeedItems before falling back to samples",
    );
    const notifications = sliceFunction(js, "screenNotifications", "screenProfile");
    assert.match(notifications, /liveNotifications/);
    assert.match(notifications, /isLive\(\)/);
    const profile = sliceFunction(js, "screenProfile", "screenSettings");
    assert.match(profile, /liveProfile/);
    assert.match(profile, /liveProfileTabItems/);
    // Own-profile counts come from the server profile, never the
    // old hard-coded sample counts — checked on the live branch
    // only (up to the preview "me" fallback), because the preview
    // branch legitimately still renders the labelled sample counts.
    const liveBranch = profile.slice(0, profile.indexOf('if (id === "me")'));
    assert.match(liveBranch, /followerCount/);
    assert.match(liveBranch, /followingCount/);
    assert.doesNotMatch(liveBranch, /12\.4K Followers/);
  });

  it("own profile resolves the signed-in user and never shows another user's private tabs as data", async () => {
    const js = await readPublic("app.js");
    assert.match(js, /resolveOwnId/);
    assert.match(js, /\/auth\/session/);
    // Bookmarks are own-only: the live branch gates them on isOwn.
    assert.match(js, /isOwn/);
    assert.match(js, /Read Later is private/);
  });

  it("401 clears the stale session and shows sign-in-required, never sample as live", async () => {
    const js = await readPublic("app.js");
    assert.match(js, /liveFetch/);
    // liveFetch clears the session on a 401 before rethrowing.
    const liveFetch = js.slice(js.indexOf("async function liveFetch"));
    assert.match(liveFetch, /clearSession\(\)/);
    assert.match(liveFetch, /authRequired: true/);
    assert.match(js, /Sign in required/);
    assert.match(js, /Sign in to see notifications/);
    assert.match(js, /Sign in to see your profile/);
  });

  it("503 falls back to labelled preview, never to silent sample data", async () => {
    const js = await readPublic("app.js");
    const liveFetch = js.slice(js.indexOf("async function liveFetch"));
    assert.match(liveFetch, /state\.mode = "preview"/);
    assert.match(liveFetch, /renderModeBanner\(\)/);
    assert.match(js, /Preview mode — not connected to live accounts/);
  });

  it("cursor pagination de-duplicates by id when loading more", async () => {
    const js = await readPublic("app.js");
    assert.match(js, /function dedupeById/);
    assert.match(js, /seen\[item\.id\]/);
    assert.match(js, /loadMoreLive/);
    assert.match(js, /nextCursor/);
    assert.match(js, /cursor=/);
    assert.match(js, /data-action="load-more"/);
    // Load-more appends through the de-dupe helper, for feed,
    // notifications, and profile lists alike.
    const loadMore = js.slice(js.indexOf("async function loadMoreLive"));
    assert.ok((loadMore.match(/dedupeById/g) ?? []).length >= 3);
  });

  it("honest gaps are stated, not hidden: no follows list, no replies/likes-by-user route", async () => {
    const js = await readPublic("app.js");
    assert.match(js, /Following list is not available yet/);
    assert.match(js, /no replies-by-user route/);
    assert.match(js, /no likes-by-user route/);
    // No profile-list route is invented for People to Discover.
    assert.match(js, /does not invent one/);
  });

  it("anonymous actors stay masked in live notifications", async () => {
    const js = await readPublic("app.js");
    const notifications = sliceFunction(js, "screenNotifications", "screenProfile");
    assert.match(notifications, /Anonymous/);
    // Live notifications render the server-masked actor, never
    // an email or a voter list.
    assert.doesNotMatch(notifications, /\.email/);
    assert.doesNotMatch(notifications, /voterList/);
  });
});

describe("served live-list pages", () => {
  it("GET / and /app.js serve the live-list frontend; health stays app-scope, docs stay 404", async () => {
    const { route } = await import("../src/app.js");
    const { loadEnv } = await import("../src/lib/env.js");
    const env = loadEnv({ PORT: "3001" });
    const home = await route("GET", "/", env);
    assert.equal(home.statusCode, 200);
    const js = await route("GET", "/app.js", env);
    assert.equal(js.statusCode, 200);
    assert.match(js.body, /loadLiveFeed/);
    assert.match(js.body, /loadLiveNotifications/);
    assert.match(js.body, /loadLiveProfile/);
    const health = await route("GET", "/api/health", env);
    assert.equal(health.statusCode, 200);
    assert.match(health.body, /not_configured/);
    const docs = await route("GET", "/api/docs", env);
    assert.equal(docs.statusCode, 404);
  });
});
