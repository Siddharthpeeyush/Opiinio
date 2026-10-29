/**
 * Error-reporting hook (Layer 16, hosting + observability).
 *
 * Today the reporter writes redacted JSON to stderr — no vendor
 * SDK, no DSN invented, ₹0. It is shaped so a future sink
 * (Sentry, a self-hosted collector) plugs in through
 * setErrorReporter WITHOUT changing any call site.
 *
 * Redaction rule (same as log.ts): the report carries the error
 * NAME only. No message (it may embed user input), no stack
 * (it may embed paths or secret material), no extra context
 * beyond requestId / route / userId. Callers decide WHAT to
 * report: 5xx only — 4xx client errors are noise, not incidents.
 */

export interface ErrorContext {
  requestId?: string;
  route?: string;
  userId?: string | null;
}

export type ErrorReporter = (err: unknown, ctx: ErrorContext) => void;

function defaultReporter(err: unknown, ctx: ErrorContext): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(
    JSON.stringify({
      level: "error",
      name,
      requestId: ctx.requestId ?? null,
      route: ctx.route ?? null,
      userId: ctx.userId ?? null,
    }),
  );
}

let reporter: ErrorReporter = defaultReporter;

/** Swap the sink (tests, or a future vendor integration). */
export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

/** Restore the default stderr reporter (tests). */
export function resetErrorReporter(): void {
  reporter = defaultReporter;
}

export function reportError(err: unknown, ctx: ErrorContext = {}): void {
  try {
    reporter(err, ctx);
  } catch {
    // A broken reporter must never break the request path.
  }
}
