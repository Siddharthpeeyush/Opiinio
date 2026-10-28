import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAuthConfig } from "../src/lib/auth.js";
import {
  challengeTotp,
  enrollTotp,
  hasVerifiedTotpFactor,
  listFactors,
  mayPerformSensitiveAction,
  readAalFromVerifiedToken,
  unenrollTotp,
  verifyTotp,
} from "../src/lib/mfa.js";

/**
 * Layer 4 MFA tests — TOTP only, mocked GoTrue responses.
 *
 * These tests never contact a live Supabase project and never
 * enroll a real factor. The live MFA proof (enroll a real
 * authenticator app, challenge at sign-in, unenroll) is a
 * dashboard/manual step in AUTH-SETUP-GUIDE.md, not something
 * these tests can fake, and it is listed as skipped.
 *
 * SMS/phone MFA exclusion is tested two ways: no helper in
 * src/lib/mfa.ts creates a phone factor (source assertion), and
 * enrollTotp always sends factor_type "totp" (request assertion).
 */

const config = getAuthConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "placeholder-not-a-real-key",
});

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function fakeJwt(payload: unknown): string {
  return `header.${base64urlJson(payload)}.signature`;
}

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function mockFetch(
  onCall: (url: string, init?: { method?: string; body?: string }) => MockResponse,
) {
  return (url: string, init?: { method?: string; body?: string }) =>
    Promise.resolve(onCall(url, init));
}

describe("readAalFromVerifiedToken() — decode only, after GoTrue verification", () => {
  it("reads aal1, aal2, and amr from a JWT payload", () => {
    assert.deepEqual(
      readAalFromVerifiedToken(fakeJwt({ aal: "aal1", amr: ["password"] })),
      {
        aal: "aal1",
        amr: ["password"],
      },
    );
    assert.deepEqual(
      readAalFromVerifiedToken(fakeJwt({ aal: "aal2", amr: ["password", "totp"] })),
      { aal: "aal2", amr: ["password", "totp"] },
    );
  });

  it("returns null aal for malformed tokens, missing aal, or unknown aal values", () => {
    assert.deepEqual(readAalFromVerifiedToken("not-a-jwt"), { aal: null, amr: [] });
    assert.deepEqual(readAalFromVerifiedToken(""), { aal: null, amr: [] });
    assert.deepEqual(readAalFromVerifiedToken(fakeJwt({ amr: ["password"] })), {
      aal: null,
      amr: ["password"],
    });
    assert.deepEqual(readAalFromVerifiedToken(fakeJwt({ aal: "aal3" })), {
      aal: null,
      amr: [],
    });
  });
});

describe("mayPerformSensitiveAction() — aal2 only when a factor is enrolled", () => {
  it("requires no step-up when the user has no enrolled factor", () => {
    assert.equal(
      mayPerformSensitiveAction("user-alice", "delete_account", "aal1", false),
      true,
    );
    assert.equal(
      mayPerformSensitiveAction("user-alice", "change_password", "aal1", false),
      true,
    );
    assert.equal(
      mayPerformSensitiveAction("user-alice", "unenroll_mfa", null, false),
      true,
    );
  });

  it("requires aal2 when the user has an enrolled factor", () => {
    assert.equal(
      mayPerformSensitiveAction("user-alice", "delete_account", "aal1", true),
      false,
    );
    assert.equal(
      mayPerformSensitiveAction("user-alice", "delete_account", null, true),
      false,
    );
    assert.equal(
      mayPerformSensitiveAction("user-alice", "delete_account", "aal2", true),
      true,
    );
    assert.equal(
      mayPerformSensitiveAction("user-alice", "change_password", "aal2", true),
      true,
    );
    assert.equal(
      mayPerformSensitiveAction("user-alice", "unenroll_mfa", "aal2", true),
      true,
    );
  });

  it("never allows a sensitive action without a user", () => {
    assert.equal(mayPerformSensitiveAction(null, "delete_account", "aal2", false), false);
    assert.equal(mayPerformSensitiveAction("", "delete_account", "aal2", true), false);
  });
});

describe("enrollTotp() — TOTP only", () => {
  it("posts factor_type totp and returns the QR/secret/uri", async () => {
    let seenUrl = "";
    let seenBody = "";
    const fetchStub = mockFetch((url, init) => {
      seenUrl = url;
      seenBody = init?.body ?? "";
      assert.equal(init?.method, "POST");
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "factor-1",
            totp: {
              qr_code: "data:image/png;base64,QR",
              secret: "SECRETNOTREAL",
              uri: "otpauth://totp/Opiinio:alice?secret=SECRETNOTREAL",
            },
          }),
      };
    });
    const enrollment = await enrollTotp(
      config,
      "session-token",
      "Authenticator",
      fetchStub,
    );
    assert.match(seenUrl, /\/auth\/v1\/factors$/);
    const body = JSON.parse(seenBody) as { factor_type: string };
    assert.equal(body.factor_type, "totp");
    assert.deepEqual(enrollment, {
      factorId: "factor-1",
      qrCode: "data:image/png;base64,QR",
      secret: "SECRETNOTREAL",
      uri: "otpauth://totp/Opiinio:alice?secret=SECRETNOTREAL",
    });
  });

  it("returns null without a session token and without calling GoTrue", async () => {
    let calls = 0;
    const fetchStub = mockFetch(() => {
      calls += 1;
      return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
    assert.equal(await enrollTotp(config, null, "Authenticator", fetchStub), null);
    assert.equal(await enrollTotp(config, "   ", "Authenticator", fetchStub), null);
    assert.equal(calls, 0);
  });
});

describe("challengeTotp() / verifyTotp() / unenrollTotp()", () => {
  it("challenges a factor and verifies a 6-digit code", async () => {
    const challengeFetch = mockFetch((url, init) => {
      assert.match(url, /\/auth\/v1\/factors\/factor-1\/challenge$/);
      assert.equal(init?.method, "POST");
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "challenge-1" }),
      };
    });
    assert.equal(
      await challengeTotp(config, "session-token", "factor-1", challengeFetch),
      "challenge-1",
    );

    let seenVerifyBody = "";
    const verifyFetch = mockFetch((url, init) => {
      assert.match(url, /\/auth\/v1\/factors\/factor-1\/verify$/);
      seenVerifyBody = init?.body ?? "";
      return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
    assert.deepEqual(
      await verifyTotp(
        config,
        "session-token",
        "factor-1",
        "challenge-1",
        "123456",
        verifyFetch,
      ),
      { verified: true },
    );
    const verifyBody = JSON.parse(seenVerifyBody) as {
      challenge_id: string;
      code: string;
    };
    assert.equal(verifyBody.challenge_id, "challenge-1");
    assert.equal(verifyBody.code, "123456");

    const rejectedFetch = mockFetch(() => ({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    }));
    assert.deepEqual(
      await verifyTotp(
        config,
        "session-token",
        "factor-1",
        "challenge-1",
        "123456",
        rejectedFetch,
      ),
      { verified: false },
    );
  });

  it("rejects malformed codes locally, without calling GoTrue", async () => {
    let calls = 0;
    const fetchStub = mockFetch(() => {
      calls += 1;
      return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
    await assert.rejects(
      () =>
        verifyTotp(
          config,
          "session-token",
          "factor-1",
          "challenge-1",
          "12345",
          fetchStub,
        ),
      /exactly 6 digits/,
    );
    await assert.rejects(
      () =>
        verifyTotp(
          config,
          "session-token",
          "factor-1",
          "challenge-1",
          "abcdef",
          fetchStub,
        ),
      /exactly 6 digits/,
    );
    assert.equal(calls, 0);
  });

  it("unenrolls with DELETE and reports rejection as false", async () => {
    const okFetch = mockFetch((url, init) => {
      assert.match(url, /\/auth\/v1\/factors\/factor-1$/);
      assert.equal(init?.method, "DELETE");
      return { ok: true, status: 200, json: () => Promise.resolve({}) };
    });
    assert.equal(await unenrollTotp(config, "session-token", "factor-1", okFetch), true);
    const badFetch = mockFetch(() => ({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
    }));
    assert.equal(
      await unenrollTotp(config, "session-token", "factor-1", badFetch),
      false,
    );
    assert.equal(await unenrollTotp(config, null, "factor-1", okFetch), false);
  });
});

describe("listFactors() / hasVerifiedTotpFactor()", () => {
  it("lists totp factors and reports verified totp presence", async () => {
    const fetchStub = mockFetch((url, init) => {
      assert.match(url, /\/auth\/v1\/factors$/);
      assert.equal(init?.method, "GET");
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            totp: [
              { id: "factor-1", friendly_name: "Authenticator", status: "verified" },
              { id: "factor-2", friendly_name: "Old phone app", status: "unverified" },
            ],
            phone: [],
          }),
      };
    });
    const factors = await listFactors(config, "session-token", fetchStub);
    assert.equal(factors.length, 2);
    assert.equal(hasVerifiedTotpFactor(factors), true);
    assert.equal(hasVerifiedTotpFactor([factors[1] as (typeof factors)[number]]), false);
    assert.equal(hasVerifiedTotpFactor([]), false);
    assert.deepEqual(await listFactors(config, null, fetchStub), []);
  });
});

describe("SMS / phone MFA is not wired", () => {
  it("src/lib/mfa.ts creates no phone factor", async () => {
    // Tests run from dist/tests/, so the repo root is two levels
    // up — the same dist-layout rule as tests/database.test.ts.
    const source = await readFile(
      join(import.meta.dirname, "..", "..", "src", "lib", "mfa.ts"),
      "utf8",
    );
    assert.ok(
      !source.includes('factor_type: "phone"'),
      "phone enrollment must not exist",
    );
    assert.ok(source.includes('factor_type: "totp"'), "TOTP enrollment must exist");
    assert.ok(
      source.includes("SMS / phone MFA is EXPLICITLY EXCLUDED"),
      "the exclusion must be documented in the module header",
    );
  });
});
