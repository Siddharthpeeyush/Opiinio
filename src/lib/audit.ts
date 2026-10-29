/**
 * Final layer — audit trail for sensitive actions.
 *
 * Design decision (docs/decisions/0017-final-layer.md): the audit
 * trail lives in the EXISTING structured log stream, not a new
 * table. Rationale:
 * - Append-only by nature (the process's stderr log stream).
 * - No migration, no new query surface to protect, no RLS to
 *   write for a table nobody should read through the app.
 * - It inherits the standing privacy rule automatically: the
 *   AuditEntry type exposes ONLY ids — there is no field a
 *   secret, email, password, topic, word, or reason could
 *   arrive on.
 *
 * An audit line is JSON: { level:"audit", audit:true, requestId,
 * userId, action, target, appEnv }. `target` is a row id (UUID),
 * a GoTrue factor id, or the literal "self" — NEVER user
 * content (no muted topics/words, no report reasons, no
 * emails). When an action has no id-shaped target, target is
 * null. JSON.stringify escapes everything, so a hostile id
 * cannot break the log line.
 */

export type AuditAction =
  | "mfa.enroll"
  | "mfa.unenroll"
  | "auth.password_change"
  | "auth.account_deletion_requested"
  | "moderation.block"
  | "moderation.unblock"
  | "moderation.mute_topic"
  | "moderation.unmute_topic"
  | "moderation.mute_word"
  | "moderation.unmute_word"
  | "moderation.report";

export interface AuditEntry {
  requestId: string;
  /** The actor. Sensitive actions always have an authenticated caller. */
  userId: string;
  action: AuditAction;
  /**
   * Row id (UUID), GoTrue factor id, or the literal "self".
   * NEVER user content. null when the action has no id-shaped target
   * (e.g. muting a topic — the topic text itself is content and is
   * deliberately not recorded).
   */
  target: string | null;
  /** development | staging | production — never a secret. */
  appEnv: string;
}

export function auditLog(entry: AuditEntry): void {
  // Redacted by construction: only these fields exist.
  console.log(
    JSON.stringify({
      level: "audit",
      audit: true,
      requestId: entry.requestId,
      userId: entry.userId,
      action: entry.action,
      target: entry.target,
      appEnv: entry.appEnv,
    }),
  );
}
