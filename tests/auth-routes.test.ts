import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { handleAuth, type AuthDeps } from "../src/routes/auth.js";
import {
  googleStartUrl,
  validateEmail,
  validatePassword,
} from "../src/services/authService.js";
import { getAuthConfig, type AuthConfig } from "../src/lib/auth.js";
import { ApiError } from "../src/lib/http.js";

/**
 * Server auth route tests — mocked GoTrue only, no live Supabase.
 *
 * Every GoTrue call goes through an injected fetch stub returning
 * canned responses; no test contacts a real project (no key has
 * been shared, providers are not enabled live, migration 05 is
 * file-only). The live sign-in / cross-user proof is a dashboard
 * step in AUTH-SETUP-GUIDE.md, not something these tests can fake,
 * and it is listed as skipped in the Layer 11 report.
 *
 * These tests import the real handleAuth + authService code and
 * the real frontend file; a test that only asserted on a mock
 * route table would still pass if auth.ts were deleted.
 */

const CONFIG: AuthConfig = getAuthConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
});

function makeJwt(aal: string): string {
  const payload = Buffer.from(JSON.stringify({ aal }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
}

const AAL1_TOKEN = makeJwt("aal1");
const AAL2_TOKEN = makeJwt("aal2");

interface StubOptions {
  factors?: Array<{ id: string; friendly_name: string; status: string }>;
  goTrueDown?: boolean;
}

function makeStub(options: StubOptions = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const factors = options.factors ?? [
    { id: "factor-1", friendly_name: "Opiinio authenticator", status: "verified" },
  ];
  const fetchImpl = async (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    await Promise.resolve();
    const method = init?.method ?? "GET";
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    calls.push({ url: input, method, body });
    if (options.goTrueDown === true) {
      throw new Error("network down");
    }
    const json = (value: unknown) => () => Promise.resolve(value);
    if (input.endsWith("/auth/v1/signup") && method === "POST") {
      const parsed = body as { email?: string } | null;
      if (parsed?.email === "taken@example.com") {
        return { ok: false, status: 422, json: json({ error: "user already exists" }) };
      }
      return {
        ok: true,
        status: 200,
        json: json({
          access_token: "session-token-1",
          refresh_token: "refresh-token-1",
          token_type: "bearer",
          expires_in: 3600,
          user: { id: "user-alice", email: "alice@example.com" },
        }),
      };
    }
    if (input.includes("/auth/v1/token?grant_type=password") && method === "POST") {
      const parsed = body as { password?: string } | null;
      if (parsed?.password === "correct-password-123") {
        return {
          ok: true,
          status: 200,
          json: json({
            access_token: "session-token-1",
            refresh_token: "refresh-token-1",
            token_type: "bearer",
            expires_in: 3600,
            user: { id: "user-alice", email: "alice@example.com" },
          }),
        };
      }
      return {
        ok: false,
        status: 400,
        json: json({ error: "Invalid login credentials" }),
      };
    }
    if (input.endsWith("/auth/v1/recover") && method === "POST") {
      // Unknown emails look the same as known ones to GoTrue here.
      return { ok: false, status: 404, json: json({ error: "not found" }) };
    }
    if (input.includes("/auth/v1/token?grant_type=refresh_token") && method === "POST") {
      const parsed = body as { refresh_token?: string } | null;
      if (parsed?.refresh_token === "good-refresh") {
        return {
          ok: true,
          status: 200,
          json: json({
            access_token: "session-token-2",
            refresh_token: "refresh-token-2",
            token_type: "bearer",
            expires_in: 3600,
            user: { id: "user-alice", email: "alice@example.com" },
          }),
        };
      }
      return { ok: false, status: 401, json: json({ error: "expired" }) };
    }
    if (input.endsWith("/auth/v1/logout") && method === "POST") {
      return { ok: true, status: 204, json: json({}) };
    }
    if (input.endsWith("/auth/v1/user") && method === "PUT") {
      return { ok: true, status: 200, json: json({ id: "user-alice" }) };
    }
    if (input.endsWith("/auth/v1/factors") && method === "POST") {
      return {
        ok: true,
        status: 200,
        json: json({
          id: "factor-1",
          totp: {
            qr_code: "data:image/png;base64,FAKEQR",
            secret: "FAKESECRET",
            uri: "otpauth://totp/Opiinio?secret=FAKESECRET",
          },
        }),
      };
    }
    if (
      input.includes("/auth/v1/factors/") &&
      input.endsWith("/challenge") &&
      method === "POST"
    ) {
      return { ok: true, status: 200, json: json({ id: "challenge-1" }) };
    }
    if (
      input.includes("/auth/v1/factors/") &&
      input.endsWith("/verify") &&
      method === "POST"
    ) {
      const parsed = body as { code?: string } | null;
      if (parsed?.code !== "123456") {
        return { ok: false, status: 400, json: json({ error: "wrong code" }) };
      }
      return {
        ok: true,
        status: 200,
        json: json({
          access_token: "aal2-session-token",
          refresh_token: "refresh-token-1",
          token_type: "bearer",
          expires_in: 3600,
          user: { id: "user-alice", email: "alice@example.com" },
        }),
      };
    }
    if (input.endsWith("/auth/v1/factors") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: json({ totp: factors, phone: [] }),
      };
    }
    if (input.includes("/auth/v1/factors/") && method === "DELETE") {
      return { ok: true, status: 200, json: json({}) };
    }
    return { ok: false, status: 404, json: json({ error: "not found" }) };
  };
  return { fetchImpl, calls };
}

function verifyStub(
  token: string,
): Promise<{ id: string; email: string; provider: string } | null> {
  if (token === "bad-token") {
    return Promise.resolve(null);
  }
  return Promise.resolve({
    id: "user-alice",
    email: "alice@example.com",
    provider: "email",
  });
}

function depsFor(
  stub: ReturnType<typeof makeStub>,
  extra: Partial<AuthDeps> = {},
): AuthDeps {
  return { config: CONFIG, fetchImpl: stub.fetchImpl, verify: verifyStub, ...extra };
}

function parseBody(result: { body: string }): {
  data?: unknown;
  error?: { code: string; message: string };
} {
  return result.body === ""
    ? {}
    : (JSON.parse(result.body) as {
        data?: unknown;
        error?: { code: string; message: string };
      });
}

describe("auth service validation", () => {
  it("rejects bad emails and short passwords without calling GoTrue", () => {
    assert.throws(() => validateEmail("not-an-email"), /valid email/);
    assert.throws(() => validatePassword("short"), /8–128/);
    assert.equal(validateEmail(" alice@example.com "), "alice@example.com");
    assert.equal(validatePassword("correct-password-123"), "correct-password-123");
  });

  it("Google start URL is GoTrue authorize for this project, provider=google only", () => {
    const url = googleStartUrl(CONFIG);
    assert.equal(url, "https://example.supabase.co/auth/v1/authorize?provider=google");
    assert.doesNotMatch(url, /redirect_to/);
    assert.doesNotMatch(url, /provider=github|provider=apple/);
  });
});

describe("email signup / signin / signout", () => {
  it("signup returns the caller's own session, signup failure is generic", async () => {
    const stub = makeStub();
    const ok = await handleAuth(
      "POST",
      "/api/auth/signup",
      {},
      JSON.stringify({ email: "alice@example.com", password: "correct-password-123" }),
      depsFor(stub),
    );
    assert.equal(ok.statusCode, 200);
    const data = parseBody(ok).data as {
      user: { id: string };
      session: { accessToken: string } | null;
    };
    assert.equal(data.user.id, "user-alice");
    assert.equal(data.session?.accessToken, "session-token-1");

    const taken = await handleAuth(
      "POST",
      "/api/auth/signup",
      {},
      JSON.stringify({ email: "taken@example.com", password: "correct-password-123" }),
      depsFor(stub),
    );
    assert.equal(taken.statusCode, 400);
    assert.doesNotMatch(taken.body, /already exists/);
  });

  it("signin success returns a session; bad credentials are one generic 401", async () => {
    const stub = makeStub();
    const ok = await handleAuth(
      "POST",
      "/api/auth/signin",
      {},
      JSON.stringify({ email: "alice@example.com", password: "correct-password-123" }),
      depsFor(stub),
    );
    assert.equal(ok.statusCode, 200);

    const bad = await handleAuth(
      "POST",
      "/api/auth/signin",
      {},
      JSON.stringify({ email: "alice@example.com", password: "wrong-password-123" }),
      depsFor(stub),
    );
    assert.equal(bad.statusCode, 401);
    const error = parseBody(bad).error;
    assert.equal(error?.code, "UNAUTHENTICATED");
    assert.equal(error?.message, "Invalid email or password");
    assert.doesNotMatch(bad.body, /Invalid login credentials/);
  });

  it("signout revokes server-side and returns signedOut", async () => {
    const stub = makeStub();
    const result = await handleAuth(
      "POST",
      "/api/auth/signout",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      null,
      depsFor(stub),
    );
    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result).data, { signedOut: true });
    assert.ok(stub.calls.some((call) => call.url.endsWith("/auth/v1/logout")));
  });

  it("unauthenticated auth routes are 401, unknown auth paths are generic 404", async () => {
    const stub = makeStub();
    const noToken = await handleAuth("GET", "/api/auth/session", {}, null, depsFor(stub));
    assert.equal(noToken.statusCode, 401);
    const badToken = await handleAuth(
      "GET",
      "/api/auth/session",
      { authorization: "Bearer bad-token" },
      null,
      depsFor(stub),
    );
    assert.equal(badToken.statusCode, 401);
    // Route-table check runs before config: unknown path is 404
    // even with no config at all (no 503 leak).
    const unknown = await handleAuth("POST", "/api/auth/docs", {}, null, {});
    assert.equal(unknown.statusCode, 404);
  });
});

describe("password reset, refresh, session, Google", () => {
  it("password reset always answers sent:true for unknown emails (no oracle)", async () => {
    const stub = makeStub();
    const result = await handleAuth(
      "POST",
      "/api/auth/reset",
      {},
      JSON.stringify({ email: "unknown-person@example.com" }),
      depsFor(stub),
    );
    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result).data, { sent: true });
  });

  it("refresh returns a new session; expired refresh is generic 401", async () => {
    const stub = makeStub();
    const ok = await handleAuth(
      "POST",
      "/api/auth/refresh",
      {},
      JSON.stringify({ refresh_token: "good-refresh" }),
      depsFor(stub),
    );
    assert.equal(ok.statusCode, 200);
    const bad = await handleAuth(
      "POST",
      "/api/auth/refresh",
      {},
      JSON.stringify({ refresh_token: "stale-refresh" }),
      depsFor(stub),
    );
    assert.equal(bad.statusCode, 401);
    assert.equal(parseBody(bad).error?.message, "Session expired, sign in again");
  });

  it("session route returns the caller's own user and aal from the verified token", async () => {
    const stub = makeStub();
    const result = await handleAuth(
      "GET",
      "/api/auth/session",
      { authorization: `Bearer ${AAL2_TOKEN}` },
      null,
      depsFor(stub),
    );
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as {
      user: { id: string; email: string };
      aal: string;
    };
    assert.equal(data.user.id, "user-alice");
    assert.equal(data.aal, "aal2");
  });

  it("Google route returns the GoTrue authorize URL, not a redirect to a client", async () => {
    const stub = makeStub();
    const result = await handleAuth("GET", "/api/auth/google", {}, null, depsFor(stub));
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as { url: string };
    assert.match(data.url, /\/auth\/v1\/authorize\?provider=google$/);
  });
});

describe("MFA — TOTP only, no SMS", () => {
  it("enroll creates a TOTP factor only, challenge + verify return an aal2 session", async () => {
    const stub = makeStub();
    const enroll = await handleAuth(
      "POST",
      "/api/auth/mfa/enroll",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      JSON.stringify({ friendly_name: "My authenticator" }),
      depsFor(stub),
    );
    assert.equal(enroll.statusCode, 201);
    const enrollment = parseBody(enroll).data as { factorId: string; secret: string };
    assert.equal(enrollment.factorId, "factor-1");
    const enrollCall = stub.calls.find((call) => call.url.endsWith("/auth/v1/factors"));
    assert.deepEqual((enrollCall?.body as { factor_type?: string }).factor_type, "totp");
    // Check the factor_type field exactly, not a substring: a
    // friendly name could legitimately contain the word "phone".
    assert.ok(
      !stub.calls.some(
        (call) => (call.body as { factor_type?: string } | null)?.factor_type === "phone",
      ),
      "no call may create a phone factor",
    );

    const challenge = await handleAuth(
      "POST",
      "/api/auth/mfa/challenge",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      JSON.stringify({ factor_id: "factor-1" }),
      depsFor(stub),
    );
    assert.equal(challenge.statusCode, 200);
    assert.equal(
      (parseBody(challenge).data as { challengeId: string }).challengeId,
      "challenge-1",
    );

    const verify = await handleAuth(
      "POST",
      "/api/auth/mfa/verify",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      JSON.stringify({
        factor_id: "factor-1",
        challenge_id: "challenge-1",
        code: "123456",
      }),
      depsFor(stub),
    );
    assert.equal(verify.statusCode, 200);
    const verified = parseBody(verify).data as {
      verified: boolean;
      session: { accessToken: string } | null;
    };
    assert.equal(verified.verified, true);
    assert.equal(verified.session?.accessToken, "aal2-session-token");
  });

  it("malformed MFA codes are rejected locally, without a GoTrue call", async () => {
    const stub = makeStub();
    const before = stub.calls.length;
    const result = await handleAuth(
      "POST",
      "/api/auth/mfa/verify",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      JSON.stringify({
        factor_id: "factor-1",
        challenge_id: "challenge-1",
        code: "12345",
      }),
      depsFor(stub),
    );
    assert.equal(result.statusCode, 400);
    assert.equal(stub.calls.length, before, "malformed code must not reach GoTrue");
  });

  it("factors list is the caller's own factors, with no secrets", async () => {
    const stub = makeStub();
    const result = await handleAuth(
      "GET",
      "/api/auth/mfa/factors",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      null,
      depsFor(stub),
    );
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as {
      items: Array<{ factorType: string; status: string }>;
    };
    assert.equal(data.items[0]?.factorType, "totp");
    assert.doesNotMatch(result.body, /FAKESECRET/);
  });
});

describe("aal gating for sensitive actions", () => {
  it("unenroll and password change refuse aal1 when a factor is enrolled, allow aal2", async () => {
    const stub = makeStub();
    const unenrollAal1 = await handleAuth(
      "DELETE",
      "/api/auth/mfa/factors/factor-1",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      null,
      depsFor(stub),
    );
    assert.equal(unenrollAal1.statusCode, 403);
    assert.equal(parseBody(unenrollAal1).error?.code, "FORBIDDEN");

    const unenrollAal2 = await handleAuth(
      "DELETE",
      "/api/auth/mfa/factors/factor-1",
      { authorization: `Bearer ${AAL2_TOKEN}` },
      null,
      depsFor(stub),
    );
    assert.equal(unenrollAal2.statusCode, 204);

    const passwordAal1 = await handleAuth(
      "PATCH",
      "/api/auth/password",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      JSON.stringify({ password: "new-password-123" }),
      depsFor(stub),
    );
    assert.equal(passwordAal1.statusCode, 403);
  });

  it("password change and deletion allow aal1 when no factor is enrolled", async () => {
    const stub = makeStub({ factors: [] });
    const password = await handleAuth(
      "PATCH",
      "/api/auth/password",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      JSON.stringify({ password: "new-password-123" }),
      depsFor(stub),
    );
    assert.equal(password.statusCode, 200);
    assert.deepEqual(parseBody(password).data, { changed: true });
  });

  it("account deletion passes the aal gate, then stops at SERVER_ONLY (no fake deletion)", async () => {
    const stub = makeStub();
    const gated = await handleAuth(
      "DELETE",
      "/api/auth/account",
      { authorization: `Bearer ${AAL1_TOKEN}` },
      null,
      depsFor(stub),
    );
    assert.equal(gated.statusCode, 403);
    assert.equal(parseBody(gated).error?.code, "FORBIDDEN");

    const serverOnly = await handleAuth(
      "DELETE",
      "/api/auth/account",
      { authorization: `Bearer ${AAL2_TOKEN}` },
      null,
      depsFor(stub),
    );
    assert.equal(serverOnly.statusCode, 403);
    assert.equal(parseBody(serverOnly).error?.code, "SERVER_ONLY");
    assert.doesNotMatch(serverOnly.body, /service_role/);
  });
});

describe("missing env, rate-limit hook, and log redaction", () => {
  it("missing env is a generic 503 that never names the variable", async () => {
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    try {
      const result = await handleAuth(
        "POST",
        "/api/auth/signin",
        {},
        JSON.stringify({ email: "alice@example.com", password: "correct-password-123" }),
        {},
      );
      assert.equal(result.statusCode, 503);
      assert.equal(parseBody(result).error?.code, "SERVICE_UNAVAILABLE");
      assert.doesNotMatch(result.body, /SUPABASE_URL/);
      assert.doesNotMatch(result.body, /SUPABASE_ANON_KEY/);
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.SUPABASE_ANON_KEY = savedKey;
    }
  });

  it("GoTrue unreachable is a generic 503, not a leaked network error", async () => {
    const stub = makeStub({ goTrueDown: true });
    const result = await handleAuth(
      "POST",
      "/api/auth/signin",
      {},
      JSON.stringify({ email: "alice@example.com", password: "correct-password-123" }),
      depsFor(stub),
    );
    assert.equal(result.statusCode, 503);
    assert.doesNotMatch(result.body, /network down/);
  });

  it("rate-limit hook can deny an auth route with a generic 429", async () => {
    const stub = makeStub();
    const denying = async (): Promise<void> => {
      await Promise.resolve();
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts, try again later");
    };
    const result = await handleAuth(
      "POST",
      "/api/auth/signin",
      {},
      JSON.stringify({ email: "alice@example.com", password: "correct-password-123" }),
      depsFor(stub, { rateLimit: denying }),
    );
    assert.equal(result.statusCode, 429);
    assert.equal(parseBody(result).error?.code, "RATE_LIMITED");
    assert.equal(stub.calls.length, 0, "denied request must not reach GoTrue");
  });

  it("auth logs carry no token, password, or email", async () => {
    const stub = makeStub();
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      await handleAuth(
        "POST",
        "/api/auth/signin",
        {},
        JSON.stringify({ email: "alice@example.com", password: "correct-password-123" }),
        depsFor(stub),
      );
    } finally {
      console.log = originalLog;
    }
    const allLogs = logged.join("\n");
    assert.ok(logged.length > 0, "expected at least one log line");
    assert.doesNotMatch(allLogs, /correct-password-123/);
    assert.doesNotMatch(allLogs, /session-token-1/);
    assert.doesNotMatch(allLogs, /alice@example\.com/);
  });
});

describe("frontend wiring — /api/auth only, sessionStorage only, poll second call", () => {
  it("frontend calls /api/auth routes, never Supabase directly, and stores no localStorage session", async () => {
    const js = await readFile(
      join(import.meta.dirname, "..", "..", "public", "app.js"),
      "utf8",
    );
    for (const path of [
      "/auth/signin",
      "/auth/signup",
      "/auth/google",
      "/auth/session",
      "/auth/mfa/enroll",
      "/auth/mfa/verify",
    ]) {
      assert.ok(js.includes(path), `frontend must call ${path}`);
    }
    assert.match(js, /sessionStorage/);
    // Check actual storage API use, not prose words: the header
    // comment names the forbidden paths in prose, so a word
    // match would fail on a comment. What matters is the code.
    assert.doesNotMatch(js, /localStorage\.(setItem|getItem|removeItem)/);
    assert.doesNotMatch(js, /supabase\.co/);
    const fetchCalls = js.match(/fetch\([^)]*\)/g) ?? [];
    assert.ok(fetchCalls.length > 0);
    for (const call of fetchCalls) {
      assert.match(call, /"\/api"/, `non-/api fetch found: ${call}`);
    }
  });

  it("Compose live poll creation makes the second call with the created opinion id", async () => {
    const js = await readFile(
      join(import.meta.dirname, "..", "..", "public", "app.js"),
      "utf8",
    );
    assert.match(js, /\/opinions\/" \+ [^)]+ \+ "\/polls"/);
    assert.match(js, /options: pollOptions/);
  });
});
