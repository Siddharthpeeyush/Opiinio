/**
 * Layer 5 — HTTP boundary helpers: one error format, generic messages.
 *
 * Privacy rule: error bodies never carry SQL, GoTrue raw errors,
 * stack traces, internal paths, tokens, or request bodies. The
 * client gets a stable code and a generic message; the server log
 * (src/lib/log.ts) gets request id, route pattern, status, and ids
 * only — never the body or the token either.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Seconds until retry, for 429 only. Never personal data. */
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message);
}

export function unauthenticated(): ApiError {
  return new ApiError(401, "UNAUTHENTICATED", "Sign in to continue");
}

export function forbidden(): ApiError {
  return new ApiError(403, "FORBIDDEN", "Not allowed");
}

export function notFound(): ApiError {
  return new ApiError(404, "NOT_FOUND", "Not found");
}

export function conflict(message: string): ApiError {
  return new ApiError(409, "CONFLICT", message);
}

export function unavailable(): ApiError {
  return new ApiError(503, "SERVICE_UNAVAILABLE", "Service unavailable");
}

/** The single error shape every API route returns. */
export function errorBody(error: ApiError): string {
  return JSON.stringify({
    error: { code: error.code, message: error.message },
  });
}

/** Map any thrown value to the single error shape — never leak detail. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  // Store/network/unknown failures all look the same from outside.
  return new ApiError(500, "INTERNAL_ERROR", "Internal error");
}

/** Parse a JSON object body. Rejects non-objects, bad JSON, oversize. */
export function parseJsonBody(
  bodyText: string | null | undefined,
): Record<string, unknown> {
  if (bodyText === null || bodyText === undefined || bodyText.trim() === "") {
    throw badRequest("Request body must be a JSON object");
  }
  if (bodyText.length > 65_536) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Reject keys the endpoint does not document — silent drops hide bugs. */
export function assertAllowedKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw badRequest(`Field not allowed: ${key}`);
    }
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw badRequest(`Field must be a string: ${field}`);
  }
  return value;
}

export function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requireString(value, field);
}
