import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Layer 6 frontend tests — static + served-page checks.
 *
 * Decision 0022 rebuilt the frontend in React + Vite (dark neon theme
 * by default, light theme via toggle). These tests do NOT run a
 * browser and do NOT claim a visual check. They prove the shipped
 * source contains the required screens/states, contains no
 * direct-Supabase path, no secret, no media upload, and the approved
 * dark/light theme tokens, and that the server serves the build. A
 * live visual check on a phone (390px) and desktop (1440px) is
 * still owed before launch — see docs/decisions/0010.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "frontend", "src");
const PUBLIC = join(ROOT, "public");

async function readSrc(name: string): Promise<string> {
  return readFile(join(SRC, name), "utf8");
}

describe("frontend privacy guards", () => {
  it("api client fetches only same-origin /api/*, never Supabase/PostgREST/GoTrue", async () => {
    const api = await readSrc("api.ts");
    // All requests go through request(), which prefixes "/api".
    assert.match(api, /`\/api\$\{path\}`/);
    assert.doesNotMatch(api, /fetch\("https?:/);
    assert.doesNotMatch(api, /fetch\(`https?:/);
    assert.doesNotMatch(api, /supabase\.co/);
    assert.doesNotMatch(api, /service_role/);
    // Session in sessionStorage — check real storage calls, not prose.
    assert.match(api, /sessionStorage\.(setItem|getItem|removeItem)/);
    assert.doesNotMatch(api, /localStorage\.(setItem|getItem|removeItem)/);
  });

  it("theme preference is the only localStorage use, never the session", async () => {
    const app = await readSrc("App.tsx");
    assert.match(app, /opiinio\.theme/);
    assert.match(app, /localStorage\.(setItem|getItem)/);
    const api = await readSrc("api.ts");
    assert.doesNotMatch(api, /localStorage\.(setItem|getItem|removeItem)/);
  });

  it("no email, token, or voter-list rendering in the UI", async () => {
    const components = await readSrc("components.tsx");
    const screens = await readSrc("screens.tsx");
    assert.doesNotMatch(components, /author\.email/);
    assert.doesNotMatch(screens, /author\.email/);
    assert.doesNotMatch(components, /voterList/);
    // Anonymous masking is applied at render.
    assert.match(components + screens, /Anonymous/);
  });

  it("no media upload, no photo, no external script or font", async () => {
    const html = await readFile(join(PUBLIC, "index.html"), "utf8");
    const app = await readSrc("App.tsx");
    const components = await readSrc("components.tsx");
    const screens = await readSrc("screens.tsx");
    const all = app + components + screens;
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(all, /type="file"/);
    assert.doesNotMatch(all, /<input[^>]*accept="image/);
    assert.doesNotMatch(html, /<script[^>]+src="http/);
    assert.doesNotMatch(html, /fonts\.googleapis/);
  });

  it("no public API docs link and no endpoint listing in the UI", async () => {
    const html = await readFile(join(PUBLIC, "index.html"), "utf8");
    const app = await readSrc("App.tsx");
    assert.doesNotMatch(html, /\/api\/docs/);
    assert.doesNotMatch(app, /\/api\/docs/);
  });

  it("approved look: dark neon default + light theme, no editorial tokens", async () => {
    const css = await readSrc("styles.css");
    // Dark neon (decision 0022): near-black blue page background.
    assert.match(css, /#060a15/);
    // Light theme override exists and defaults to dark.
    assert.match(css, /\[data-theme="light"\]/);
    // The superseded editorial paper look must not come back.
    assert.doesNotMatch(css, /#faf3e3/);
  });
});

describe("frontend screens and states", () => {
  it("all screens exist in code", async () => {
    const screens = await readSrc("screens.tsx");
    const app = await readSrc("App.tsx");
    for (const name of [
      "WelcomeScreen",
      "SignInScreen",
      "ExploreScreen",
      "DebatesScreen",
      "FollowingScreen",
      "NotificationsScreen",
      "BookmarksScreen",
      "ProfileScreen",
      "PostDetailScreen",
      "ComposeScreen",
    ]) {
      assert.ok(screens.includes(name), `missing screen: ${name}`);
    }
    // The feed screen lives in App.tsx (it owns the feed state).
    assert.ok(app.includes("FeedScreen"), "missing screen: FeedScreen");
  });

  it("hash routes cover every screen", async () => {
    const app = await readSrc("App.tsx");
    for (const route of [
      "#/",
      "#/signin",
      "#/welcome",
      "#/explore",
      "#/debates",
      "#/following",
      "#/notifications",
      "#/bookmarks",
      "#/profile",
      "#/compose",
      "#/post/",
    ]) {
      assert.ok(app.includes(route), `missing route: ${route}`);
    }
  });

  it("all 10 features are wired in code, not just named", async () => {
    const components = await readSrc("components.tsx");
    const screens = await readSrc("screens.tsx");
    const app = await readSrc("App.tsx");
    const all = components + screens + app;
    assert.match(all, /api\.vote|onStance/); // stance
    assert.match(all, /OpinionMeter/); // opinion meter
    assert.match(all, /for.*against|sideFilter/); // debate mode
    assert.match(all, /quote_take|Quote/); // quote repost
    assert.match(all, /Today.s question|Daily Question/i); // daily question
    assert.match(all, /is_anonymous|anonymous/); // anonymous mode
    assert.match(all, /castPollVote|createPoll/); // polls
    assert.match(all, /Best Argument/); // voice score sort
    assert.match(all, /addBookmark|Bookmark/); // bookmarks
    assert.match(all, /280/); // char limit
  });

  it("every view has loading, empty, and error states", async () => {
    const screens = await readSrc("screens.tsx");
    assert.match(screens, /loading/);
    assert.match(screens, /empty-state/);
    assert.match(screens, /error/);
    assert.match(screens, /Sign in to/);
  });

  it("theme toggle exists and dark is the default", async () => {
    const app = await readSrc("App.tsx");
    const components = await readSrc("components.tsx");
    assert.match(app, /useTheme/);
    assert.match(app, /toggleTheme/);
    assert.match(components, /onToggleTheme/);
    // Default is dark when nothing is stored.
    assert.match(app, /"light"\s*:\s*"dark"|=== "light" \? "light" : "dark"/);
  });

  it("overflow-safe CSS for the 390px phone viewport", async () => {
    const css = await readSrc("styles.css");
    assert.match(css, /minmax\(0, 1fr\)/);
    assert.match(css, /flex-wrap: wrap/);
    assert.match(css, /@media \(max-width: 820px\)/);
    assert.doesNotMatch(css, /width: 100vw/);
  });
});

describe("served frontend pages", () => {
  it("GET / serves the React app shell", async () => {
    const { route } = await import("../src/app.js");
    const { loadEnv } = await import("../src/lib/env.js");
    const env = loadEnv({ PORT: "3001" });
    const home = await route("GET", "/", env);
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /Opiinio/);
    assert.match(home.body, /<div id="root"><\/div>/);
  });

  it("GET /assets/* serves the built bundle; /app.js is gone", async () => {
    const { route } = await import("../src/app.js");
    const { loadEnv } = await import("../src/lib/env.js");
    const env = loadEnv({ PORT: "3001" });
    const html = await route("GET", "/", env);
    const asset = html.body.match(/\/assets\/index-[^"]+\.js/);
    assert.ok(asset, "index.html must reference a hashed bundle");
    const js = await route("GET", asset[0], env);
    assert.equal(js.statusCode, 200);
    assert.equal(js.contentType, "text/javascript");
    const gone = await route("GET", "/app.js", env);
    assert.equal(gone.statusCode, 404);
    const traversal = await route("GET", "/assets/../../src/app.ts", env);
    assert.equal(traversal.statusCode, 404);
    const docs = await route("GET", "/api/docs", env);
    assert.equal(docs.statusCode, 404);
  });
});
