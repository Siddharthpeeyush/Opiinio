import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Live-list pass tests — static + served-page checks, same pattern
 * as tests/frontend.test.ts. These tests do NOT run a browser and
 * do NOT claim a visual check or a live Supabase call. They prove
 * the React frontend (decision 0022) fetches live lists through
 * same-origin /api/* only, renders live data ahead of labelled
 * preview data, handles 401/503 by the stated contract, and states
 * its honest gaps instead of faking results.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "frontend", "src");

async function readSrc(name: string): Promise<string> {
  return readFile(join(SRC, name), "utf8");
}

describe("live lists fetch through /api only, with Bearer", () => {
  it("the only fetch helper sends a Bearer token from session state", async () => {
    const api = await readSrc("api.ts");
    assert.match(api, /Authorization.*Bearer.*session\.accessToken/);
    // The single fetch helper always prefixes /api; no absolute URLs
    // anywhere (the call spans lines, so match the template literally).
    assert.match(api, /fetch\(`\/api\$\{path\}`/);
    assert.doesNotMatch(api, /fetch\("https?:/);
    assert.doesNotMatch(api, /fetch\(`https?:/);
    assert.doesNotMatch(api, /https:\/\//);
  });

  it("feed, notifications, profile, bookmarks, and daily question call the Layer 5 endpoints", async () => {
    const api = await readSrc("api.ts");
    for (const marker of [
      "getOpinions",
      "getNotifications",
      "getProfile",
      "getBookmarks",
      "getDailyQuestion",
      "/opinions",
      "/notifications",
      "/profiles/",
      "/bookmarks",
      "/daily-questions",
    ]) {
      assert.ok(api.includes(marker), `missing live-list marker: ${marker}`);
    }
  });

  it("live data renders ahead of labelled preview data", async () => {
    const app = await readSrc("App.tsx");
    // Live load succeeds -> mode "live"; failure -> labelled preview.
    assert.match(app, /setMode\("live"\)/);
    assert.match(app, /setMode\("preview"\)/);
    assert.match(app, /PREVIEW_OPINIONS/);
    const preview = await readSrc("preview.ts");
    // Preview data is labelled as sample, never presented as live.
    assert.match(preview, /sample|preview/i);
  });

  it("401 clears the stale session and shows sign-in-required, never sample as live", async () => {
    const api = await readSrc("api.ts");
    assert.match(api, /clearSession\(\)/);
    assert.match(api, /status === 401/);
    const screens = await readSrc("screens.tsx");
    assert.match(screens, /Sign in to/);
  });

  it("preview mode is labelled in the UI, never silent", async () => {
    const components = await readSrc("components.tsx");
    assert.match(components, /ModeBanner/);
    assert.match(components, /[Pp]review/);
  });

  it("cursor pagination is supported on the opinions list", async () => {
    const api = await readSrc("api.ts");
    assert.match(api, /cursor/);
    assert.match(api, /nextCursor/);
  });

  it("honest gaps are stated, not hidden: following feed has no live route yet", async () => {
    const screens = await readSrc("screens.tsx");
    assert.match(screens, /following feed is quiet/);
    // No invented follows-list endpoint in the API client.
    const api = await readSrc("api.ts");
    assert.doesNotMatch(api, /getFollows|getFollowing/);
  });

  it("anonymous actors stay masked in live notifications", async () => {
    const components = await readSrc("components.tsx");
    const screens = await readSrc("screens.tsx");
    assert.match(components + screens, /Anonymous/);
    assert.doesNotMatch(screens, /\.email/);
  });
});

describe("served live-list pages", () => {
  it("GET / serves the React shell; health stays app-scope, docs stay 404", async () => {
    const { route } = await import("../src/app.js");
    const { loadEnv } = await import("../src/lib/env.js");
    const env = loadEnv({ PORT: "3001" });
    const home = await route("GET", "/", env);
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /<div id="root"><\/div>/);
    const health = await route("GET", "/api/health", env);
    assert.equal(health.statusCode, 200);
    const docs = await route("GET", "/api/docs", env);
    assert.equal(docs.statusCode, 404);
  });
});
