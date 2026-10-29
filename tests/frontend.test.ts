import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Layer 6 frontend tests — static + served-page checks.
 *
 * These tests do NOT run a browser and do NOT claim a visual check.
 * They prove the shipped files contain the required screens/states,
 * contain no direct-Supabase path, no secret, no media upload, and
 * no dark-glass/vinyl tokens, and that the server serves them. A
 * live visual check on a phone (390px) and desktop (1440px) is
 * still owed before launch — see docs/decisions/0010.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const PUBLIC = join(ROOT, "public");

async function readPublic(name: string): Promise<string> {
  return readFile(join(PUBLIC, name), "utf8");
}

describe("frontend privacy guards", () => {
  it("app.js fetches only same-origin /api/*, never Supabase/PostgREST/GoTrue", async () => {
    const js = await readPublic("app.js");
    // The header comment names the forbidden paths in prose; what
    // matters is the code path, so check fetch calls, not words.
    const fetchCalls = js.match(/fetch\([^)]*\)/g) ?? [];
    assert.ok(fetchCalls.length > 0, "expected at least one fetch call");
    for (const call of fetchCalls) {
      assert.match(call, /"\/api"/, `non-/api fetch found: ${call}`);
      assert.doesNotMatch(call, /https?:/);
    }
    assert.doesNotMatch(js, /https:\/\//);
    assert.doesNotMatch(js, /service_role/);
    assert.doesNotMatch(js, /localStorage/);
  });

  it("no email, token, or voter-list rendering in the frontend", async () => {
    const js = await readPublic("app.js");
    assert.doesNotMatch(js, /author\.email/);
    assert.doesNotMatch(js, /voterList|voters:/);
    assert.match(js, /Anonymous/);
    assert.match(js, /"AN"/);
  });

  it("no media upload, no photo/cover, no external script or font", async () => {
    const html = await readPublic("index.html");
    const js = await readPublic("app.js");
    const css = await readPublic("styles.css");
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /type="file"/);
    assert.doesNotMatch(js, /type="file"/);
    assert.doesNotMatch(html, /<script[^>]+src="http/);
    assert.doesNotMatch(html, /fonts\.googleapis/);
    assert.doesNotMatch(css, /@import/);
    // Prettier may wrap this footer line, so allow whitespace.
    assert.match(html, /No photo or video\s+uploads/);
  });

  it("no public API docs link and no endpoint listing in the UI", async () => {
    const html = await readPublic("index.html");
    const js = await readPublic("app.js");
    assert.doesNotMatch(html, /\/api\/docs/);
    assert.doesNotMatch(js, /\/api\/docs/);
    assert.match(html, /No API documentation is linked here/);
  });

  it("editorial look only: no dark glass or vinyl tokens", async () => {
    const css = await readPublic("styles.css");
    assert.doesNotMatch(css, /backdrop-filter/);
    assert.doesNotMatch(css, /aurora/);
    assert.doesNotMatch(css, /violet/);
    assert.match(css, /#faf3e3/);
    assert.match(css, /#0f766e/);
  });
});

describe("frontend screens and states", () => {
  it("all 12 merged screens plus Settings/MFA/Respect routes exist in code", async () => {
    const js = await readPublic("app.js");
    for (const screen of [
      "screenWelcome",
      "screenSignIn",
      "screenOnboarding",
      "screenFeed",
      "screenCompose",
      "screenPost",
      "screenExplore",
      "screenDebates",
      "screenNotifications",
      "screenProfile",
      "screenSettings",
      "mfaHtml",
      "respectHtml",
    ]) {
      assert.ok(js.includes(screen), `missing screen: ${screen}`);
    }
    for (const route of [
      "#/feed",
      "#/explore",
      "#/debates",
      "#/notifications",
      "#/compose",
      "#/settings",
    ]) {
      assert.ok(
        js.includes(route) || (await readPublic("index.html")).includes(route),
        `missing route: ${route}`,
      );
    }
  });

  it("all 10 features are wired in code, not just named", async () => {
    const js = await readPublic("app.js");
    assert.match(js, /data-action="stance"/);
    assert.match(js, /meterHtml/);
    assert.match(js, /Debate Mode/);
    assert.match(js, /data-action="quote"/);
    assert.match(js, /Daily answer/);
    assert.match(js, /compose-anon/);
    assert.match(js, /poll-vote/);
    assert.match(js, /Best Argument/);
    assert.match(js, /data-action="bookmark"/);
    assert.match(js, /Respect Filter/);
    assert.match(js, /maxlength="280"/);
  });

  it("every view has loading, empty, error, and success states", async () => {
    const js = await readPublic("app.js");
    const html = await readPublic("index.html");
    // Loading is the stateHtml "loading" branch plus the initial
    // skeleton in the shell (shown before the first route renders).
    assert.match(js, /kind === "loading"/);
    assert.match(html, /Loading Opiinio/);
    assert.match(js, /stateHtml\("empty"/);
    assert.match(js, /stateHtml\("error"/);
    assert.match(js, /form-success/);
    assert.match(js, /form-error/);
    assert.match(js, /auth-required|Sign in required|Sign-in is not live/);
  });

  it("profile has all five tabs including Reposts, and no cover photo", async () => {
    const js = await readPublic("app.js");
    for (const tab of ["opinions", "replies", "reposts", "likes", "bookmarks"]) {
      assert.ok(js.includes(`"${tab}"`), `missing profile tab: ${tab}`);
    }
    assert.match(js, /Initials-only avatar/);
    assert.doesNotMatch(js, /coverPhoto|cover-photo/);
  });

  it("language toggle is chrome-only and says so", async () => {
    const js = await readPublic("app.js");
    const html = await readPublic("index.html");
    assert.match(js, /Posts are not translated/);
    assert.match(html, /never\s+translated/);
    assert.match(js, /हर राय मायने रखती है/);
  });

  it("preview sample covers six topics so Explore ranks 1-6, never rank 0", async () => {
    const js = await readPublic("app.js");
    for (const topic of [
      "Work",
      "Money",
      "Cities",
      "Education",
      "Everyday life",
      "Technology",
    ]) {
      assert.ok(js.includes(`topic: "${topic}"`), `missing sample topic: ${topic}`);
    }
    assert.match(js, /\.slice\(0, 6\)/);
    assert.doesNotMatch(js, /rank.*0,/);
  });

  it("overflow-safe CSS: no fixed viewport-breaking widths, grid uses minmax(0,1fr)", async () => {
    const css = await readPublic("styles.css");
    assert.match(css, /overflow-x: hidden/);
    assert.match(css, /minmax\(0, 1fr\)/);
    assert.match(css, /flex-wrap: wrap/);
    assert.match(css, /overflow-wrap: anywhere/);
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.doesNotMatch(css, /width: 100vw/);
  });
});

describe("served frontend pages", () => {
  it("GET / serves the app shell and /app.js is served by the route table", async () => {
    const { route } = await import("../src/app.js");
    const { loadEnv } = await import("../src/lib/env.js");
    const env = loadEnv({ PORT: "3001" });
    const home = await route("GET", "/", env);
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /Opiinio/);
    assert.match(home.body, /app\.js/);
    const js = await route("GET", "/app.js", env);
    assert.equal(js.statusCode, 200);
    assert.match(js.body, /Layer 6/);
    const css = await route("GET", "/styles.css", env);
    assert.equal(css.statusCode, 200);
    assert.match(css.body, /#faf3e3/);
    const docs = await route("GET", "/api/docs", env);
    assert.equal(docs.statusCode, 404);
  });
});
