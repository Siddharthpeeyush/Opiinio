/**
 * TOTP MFA (authenticator app) via Supabase Auth — Layer 4 addition.
 *
 * FREE, and on by default: TOTP MFA is enabled on every Supabase
 * project by default and needs no paid add-on. This module wires
 * TOTP only (Google Authenticator / Authy / any RFC 6238 app).
 *
 * SMS / phone MFA is EXPLICITLY EXCLUDED: it is a paid add-on in
 * Supabase and would break the locked ₹0 / no-SMS-OTP rule. There
 * is no phone-factor enrollment helper in this file, and no code
 * path here creates a phone factor. If a user somehow has a phone
 * factor, listFactors() reports it (read-only visibility), but
 * nothing here enrolls, challenges, or verifies one.
 *
 * OPTIONAL at launch: MFA is opt-in per user. Forcing it would
 * lock out users who lose a device. Sensitive account actions
 * (delete account, change password, unenroll MFA) require aal2
 * ONLY when the user already has an enrolled factor; otherwise
 * aal1 is sufficient. See mayPerformSensitiveAction() below and
 * docs/decisions/0008-layer4-auth.md.
 *
 * NO BACKUP CODES: Supabase MFA has no built-in backup codes, so
 * this module invents none and must never claim otherwise. Lost
 * device recovery is: unenroll from an authenticated session, or
 * admin unenroll in the Supabase dashboard (see
 * AUTH-SETUP-GUIDE.md). Both are outside client code.
 *
 * AAL READING — READ THIS BEFORE USING readAal():
 * readAalFromVerifiedToken() only DECODES the JWT payload; it does
 * NOT verify the signature, and it must NEVER be called on an
 * unverified token. Call verifySession() (lib/auth.ts, GoTrue)
 * first, and only then read aal/amr from that verified session's
 * token. A token GoTrue rejected has no trustworthy aal, whatever
 * its payload says.
 */

import type { AuthConfig } from "./auth.js";
import { AuthUnavailableError } from "./auth.js";

export type AssuranceLevel = "aal1" | "aal2";

export interface AalInfo {
  aal: AssuranceLevel | null;
  /** Authentication methods, e.g. ["password"] or ["password", "totp"]. */
  amr: string[];
}

/**
 * Decode aal/amr from a JWT payload. Pure decode only — see the
 * header warning. Returns null aal for malformed tokens, tokens
 * without an aal claim, or aal values other than aal1/aal2.
 */
export function readAalFromVerifiedToken(token: string): AalInfo {
  try {
    const parts = token.split(".");
    const payloadPart = parts[1];
    if (parts.length !== 3 || payloadPart === undefined || payloadPart === "") {
      return { aal: null, amr: [] };
    }
    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as { aal?: unknown; amr?: unknown };
    const aal = payload.aal === "aal1" || payload.aal === "aal2" ? payload.aal : null;
    const amr = Array.isArray(payload.amr)
      ? payload.amr.filter((entry): entry is string => typeof entry === "string")
      : [];
    return { aal, amr };
  } catch {
    return { aal: null, amr: [] };
  }
}

export type SensitiveAccountAction =
  | "delete_account"
  | "change_password"
  | "unenroll_mfa";

/**
 * Gate for sensitive account actions. The action itself is NOT in
 * this module's scope (account deletion / password change are
 * Layer 5+); this is only the aal rule Layer 5 must check first.
 *
 * - No user -> false (callers map this to 401 via deniedStatus).
 * - User with NO enrolled factor -> aal1 is sufficient (true).
 *   Forcing aal2 on a user who never enrolled would be impossible
 *   to satisfy.
 * - User WITH an enrolled factor -> only aal2 (true); aal1 or
 *   unknown aal (false). This is the step-up: a stolen password
 *   alone must not delete the account or unenroll the factor.
 */
export function mayPerformSensitiveAction(
  userId: string | null | undefined,
  _action: SensitiveAccountAction,
  aal: AssuranceLevel | null,
  hasEnrolledFactor: boolean,
): boolean {
  if (userId === null || userId === undefined || userId === "") {
    return false;
  }
  if (!hasEnrolledFactor) {
    return true;
  }
  return aal === "aal2";
}

type MfaFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function mfaHeaders(config: AuthConfig, sessionToken: string): Record<string, string> {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${sessionToken}`,
    "Content-Type": "application/json",
  };
}

async function mfaCall<T>(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  fetchImpl: MfaFetch,
  parse: (body: unknown) => T | null,
): Promise<T | null> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new AuthUnavailableError();
  }
  if (!response.ok) {
    return null;
  }
  return parse(await response.json());
}

export interface TotpEnrollment {
  factorId: string;
  /** QR code (data URI / SVG string from GoTrue) to show once. */
  qrCode: string;
  /** TOTP secret — show once, never log, never store in this repo. */
  secret: string;
  /** otpauth:// URI for manual entry in the authenticator app. */
  uri: string;
}

/**
 * Start TOTP enrollment. Returns the QR/secret/uri to display in
 * the Layer 6 enroll screen. The factor is NOT active until the
 * user verifies a code from the authenticator app (verifyTotp
 * with the challenge from challengeTotp, or GoTrue's enroll
 * verify step) — an unverified factor must never gate actions.
 */
export async function enrollTotp(
  config: AuthConfig,
  sessionToken: string | null | undefined,
  friendlyName: string,
  fetchImpl: MfaFetch = fetch as unknown as MfaFetch,
): Promise<TotpEnrollment | null> {
  if (sessionToken === null || sessionToken === undefined || sessionToken.trim() === "") {
    return null;
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  return mfaCall(
    `${base}/auth/v1/factors`,
    {
      method: "POST",
      headers: mfaHeaders(config, sessionToken.trim()),
      // TOTP only. There is deliberately no phone factor_type here.
      body: JSON.stringify({ factor_type: "totp", friendly_name: friendlyName }),
    },
    fetchImpl,
    (body) => {
      const parsed = body as {
        id?: unknown;
        totp?: { qr_code?: unknown; secret?: unknown; uri?: unknown };
      };
      if (
        typeof parsed.id !== "string" ||
        parsed.id === "" ||
        typeof parsed.totp?.qr_code !== "string" ||
        typeof parsed.totp?.secret !== "string" ||
        typeof parsed.totp?.uri !== "string"
      ) {
        return null;
      }
      return {
        factorId: parsed.id,
        qrCode: parsed.totp.qr_code,
        secret: parsed.totp.secret,
        uri: parsed.totp.uri,
      };
    },
  );
}

/** Create a challenge for an enrolled TOTP factor (sign-in step-up). */
export async function challengeTotp(
  config: AuthConfig,
  sessionToken: string | null | undefined,
  factorId: string,
  fetchImpl: MfaFetch = fetch as unknown as MfaFetch,
): Promise<string | null> {
  if (
    sessionToken === null ||
    sessionToken === undefined ||
    sessionToken.trim() === "" ||
    factorId === ""
  ) {
    return null;
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  return mfaCall(
    `${base}/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`,
    { method: "POST", headers: mfaHeaders(config, sessionToken.trim()), body: "{}" },
    fetchImpl,
    (body) => {
      const parsed = body as { id?: unknown };
      return typeof parsed.id === "string" && parsed.id !== "" ? parsed.id : null;
    },
  );
}

export interface TotpVerification {
  verified: boolean;
}

/**
 * Verify a 6-digit TOTP code against a challenge. The code format
 * is validated locally (no network call for a malformed code) so
 * a typo cannot be mistaken for a GoTrue rejection.
 */
export async function verifyTotp(
  config: AuthConfig,
  sessionToken: string | null | undefined,
  factorId: string,
  challengeId: string,
  code: string,
  fetchImpl: MfaFetch = fetch as unknown as MfaFetch,
): Promise<TotpVerification> {
  if (!/^\d{6}$/.test(code)) {
    throw new Error("TOTP code must be exactly 6 digits");
  }
  if (
    sessionToken === null ||
    sessionToken === undefined ||
    sessionToken.trim() === "" ||
    factorId === "" ||
    challengeId === ""
  ) {
    return { verified: false };
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const result = await mfaCall(
    `${base}/auth/v1/factors/${encodeURIComponent(factorId)}/verify`,
    {
      method: "POST",
      headers: mfaHeaders(config, sessionToken.trim()),
      body: JSON.stringify({ challenge_id: challengeId, code }),
    },
    fetchImpl,
    () => true,
  );
  return { verified: result === true };
}

export interface MfaFactor {
  id: string;
  friendlyName: string;
  /** "totp" or "phone" (phone is reported only, never enrolled here). */
  factorType: string;
  status: string;
}

/** List the user's factors. Read-only; never enrolls anything. */
export async function listFactors(
  config: AuthConfig,
  sessionToken: string | null | undefined,
  fetchImpl: MfaFetch = fetch as unknown as MfaFetch,
): Promise<MfaFactor[]> {
  if (sessionToken === null || sessionToken === undefined || sessionToken.trim() === "") {
    return [];
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const result = await mfaCall(
    `${base}/auth/v1/factors`,
    { method: "GET", headers: mfaHeaders(config, sessionToken.trim()) },
    fetchImpl,
    (body) => {
      const parsed = body as {
        totp?: Array<{ id?: unknown; friendly_name?: unknown; status?: unknown }>;
        phone?: Array<{ id?: unknown; friendly_name?: unknown; status?: unknown }>;
      };
      const factors: MfaFactor[] = [];
      for (const entry of parsed.totp ?? []) {
        if (typeof entry.id === "string") {
          factors.push({
            id: entry.id,
            friendlyName:
              typeof entry.friendly_name === "string" ? entry.friendly_name : "",
            factorType: "totp",
            status: typeof entry.status === "string" ? entry.status : "",
          });
        }
      }
      // Phone factors, if any exist, are reported here for
      // visibility only. Nothing in this module creates one.
      for (const entry of parsed.phone ?? []) {
        if (typeof entry.id === "string") {
          factors.push({
            id: entry.id,
            friendlyName:
              typeof entry.friendly_name === "string" ? entry.friendly_name : "",
            factorType: "phone",
            status: typeof entry.status === "string" ? entry.status : "",
          });
        }
      }
      return factors;
    },
  );
  return result ?? [];
}

/** Unenroll a TOTP factor. Layer 5 must gate this with mayPerformSensitiveAction(). */
export async function unenrollTotp(
  config: AuthConfig,
  sessionToken: string | null | undefined,
  factorId: string,
  fetchImpl: MfaFetch = fetch as unknown as MfaFetch,
): Promise<boolean> {
  if (
    sessionToken === null ||
    sessionToken === undefined ||
    sessionToken.trim() === "" ||
    factorId === ""
  ) {
    return false;
  }
  const base = config.supabaseUrl.replace(/\/+$/, "");
  const result = await mfaCall(
    `${base}/auth/v1/factors/${encodeURIComponent(factorId)}`,
    { method: "DELETE", headers: mfaHeaders(config, sessionToken.trim()) },
    fetchImpl,
    () => true,
  );
  return result === true;
}

/** True when the user has at least one verified TOTP factor. */
export function hasVerifiedTotpFactor(factors: MfaFactor[]): boolean {
  return factors.some(
    (factor) => factor.factorType === "totp" && factor.status === "verified",
  );
}
