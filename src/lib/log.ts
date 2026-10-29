/**
 * Layer 5 — structured, redacted logs. A log line carries only:
 * request id, route pattern (never the raw path with ids in it),
 * method, status, duration in ms, the app environment, and a user
 * id when a session exists.
 *
 * It NEVER carries: tokens, passwords, OTP/MFA codes, emails,
 * request bodies, query strings, headers, or stack traces. If a
 * future field is added here, it must pass that list first.
 */

import { randomUUID } from "node:crypto";

export interface LogEntry {
  requestId: string;
  route: string;
  method: string;
  status: number;
  userId: string | null;
  /** Wall-clock ms the handler spent on this request. */
  durationMs: number;
  /** development | staging | production — never a secret. */
  appEnv: string;
}

export function newRequestId(): string {
  return randomUUID();
}

export function logRequest(entry: LogEntry): void {
  // JSON, one line, redacted by construction: only these fields exist.
  console.log(
    JSON.stringify({
      level: "info",
      requestId: entry.requestId,
      route: entry.route,
      method: entry.method,
      status: entry.status,
      durationMs: entry.durationMs,
      appEnv: entry.appEnv,
      userId: entry.userId,
    }),
  );
}

/** Security headers on every API response. No server fingerprint. */
export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  // Deliberately absent: X-Powered-By (Node does not set it, and
  // this layer must never add a header that identifies the stack).
};
