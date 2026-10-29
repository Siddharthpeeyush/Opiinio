/**
 * Layer 11 — rate limiting.
 *
 * Shape: a fixed-window counter per (bucket, key). The store is an
 * interface, not a concrete database, so a shared store (Redis /
 * Upstash / any HTTP counter) can replace the in-memory store
 * without rewriting a route — that replacement is a documented
 * follow-up for multi-instance deploys, not this layer.
 *
 * Privacy rules, same as Layer 5:
 * - A key is NEVER a raw IP, email, or token. IPs and emails are
 *   hashed (SHA-256, truncated) before they become part of a key,
 *   and the hashed value is never logged or returned. User ids
 *   are internal ids, already allowed in log lines.
 * - A 429 body is the single generic error shape: code
 *   RATE_LIMITED, message "Too many attempts, try again later",
 *   plus a Retry-After header. It never names an account, an
 *   email, or whether an account exists — so a 429 is not an
 *   enumeration oracle.
 * - Rate-limit state is never logged beyond route + status
 *   (src/lib/log.ts carries no keys, counts, or windows).
 *
 * Keying order (abuse review, see decision 0013):
 * - Authenticated routes: key by user id first. A shared IP
 *   (college / hostel NAT) must not let one user's hammering
 *   block every other user behind the same address, and must
 *   not let an attacker on a shared IP exhaust a victim's
 *   budget either — the victim's own user-id bucket is
 *   separate. The trade-off that remains: an attacker who
 *   owns an account gets that account's full budget, and an
 *   unauthenticated attacker shares the IP bucket with other
 *   unauthenticated callers behind the same NAT.
 * - Unauthenticated auth routes (signup / signin / reset):
 *   key by BOTH the hashed email and the hashed IP, and both
 *   must pass. The email key stops targeted credential
 *   stuffing against one account; the IP key stops a
 *   distributed spray from one address. A legitimate user on
 *   a shared IP can hit the IP bucket — that is the cost of
 *   the strict bucket, and the documented remedy is the
 *   per-email budget being separate, so their own account is
 *   not locked by someone else's spray alone.
 * - Everything else: key by user id when a session exists,
 *   otherwise by hashed IP. Behind a proxy, server.ts passes
 *   the direct socket address (not X-Forwarded-For, which is
 *   spoofable); a trusted-proxy header is a future, recorded
 *   step, not silently trusted here.
 */

import { createHash } from "node:crypto";
import { ApiError } from "./http.js";

export interface RateLimitBucket {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Minimal counter store. `nowMs` is injectable so tests can move time. */
export interface RateLimitStore {
  consume(
    key: string,
    limit: number,
    windowMs: number,
    nowMs?: number,
  ): Promise<RateLimitDecision>;
}

/** In-memory fixed-window store. Single process only — see header. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    nowMs: number = Date.now(),
  ): Promise<RateLimitDecision> {
    await Promise.resolve();
    if (this.entries.size > 10_000) {
      for (const [storedKey, entry] of this.entries) {
        if (entry.resetAt <= nowMs) {
          this.entries.delete(storedKey);
        }
      }
    }
    const existing = this.entries.get(key);
    if (existing === undefined || existing.resetAt <= nowMs) {
      this.entries.set(key, { count: 1, resetAt: nowMs + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Test / shutdown helper only. Not used by routes. */
  clear(): void {
    this.entries.clear();
  }
}

/** One-way hash for IP / email key parts. Never log the input. */
export function hashKeyPart(value: string): string {
  return createHash("sha256")
    .update(`opiinio-rate-limit:v1:${value}`)
    .digest("hex")
    .slice(0, 32);
}

export const RATE_LIMIT_BUCKETS = {
  /** Playbook strict bucket: 5 attempts per 15 minutes. */
  authStrict: { limit: 5, windowMs: 15 * 60 * 1000 },
  /** Other authenticated auth actions: 20 per 15 minutes. */
  authGeneral: { limit: 20, windowMs: 15 * 60 * 1000 },
  /** Writes (opinions, replies, votes, likes, reposts, follows, reports). */
  write: { limit: 60, windowMs: 5 * 60 * 1000 },
  /** General reads (feed, post detail, notifications, profiles). */
  read: { limit: 300, windowMs: 5 * 60 * 1000 },
  /** Search is a read, but scannable — stricter than general reads. */
  search: { limit: 60, windowMs: 5 * 60 * 1000 },
} as const;

export type RateLimitBucketName = keyof typeof RATE_LIMIT_BUCKETS;

/** Strict (5/15min) auth routes; everything else auth is general. */
export function bucketForAuthRoute(pattern: string): RateLimitBucketName {
  if (
    pattern === "/api/auth/signup" ||
    pattern === "/api/auth/signin" ||
    pattern === "/api/auth/reset"
  ) {
    return "authStrict";
  }
  return "authGeneral";
}

export function isAuthStrictRoute(pattern: string): boolean {
  return bucketForAuthRoute(pattern) === "authStrict";
}

/** API bucket by method + resource. Route-table 404s never reach here. */
export function bucketForApiRoute(
  method: string,
  rest: string[],
  hasSearch: boolean,
): RateLimitBucketName {
  if (method === "GET" && rest[0] === "opinions" && hasSearch) {
    return "search";
  }
  if (method === "GET") {
    return "read";
  }
  return "write";
}

export class RateLimiter {
  private readonly store: RateLimitStore;
  private readonly buckets: Record<RateLimitBucketName, RateLimitBucket>;

  constructor(
    store: RateLimitStore = new InMemoryRateLimitStore(),
    buckets: Record<RateLimitBucketName, RateLimitBucket> = RATE_LIMIT_BUCKETS,
  ) {
    this.store = store;
    this.buckets = buckets;
  }

  /** Throws a generic 429 (with Retry-After) when the budget is spent. */
  async check(bucket: RateLimitBucketName, key: string): Promise<void> {
    const config = this.buckets[bucket];
    const decision = await this.store.consume(
      `${bucket}:${key}`,
      config.limit,
      config.windowMs,
    );
    if (!decision.allowed) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Too many attempts, try again later",
        decision.retryAfterSeconds,
      );
    }
  }

  /** Auth-route check: every supplied key must pass (email + IP, etc.). */
  async checkAuthRoute(pattern: string, keys: string[]): Promise<void> {
    const bucket = bucketForAuthRoute(pattern);
    for (const key of keys) {
      await this.check(bucket, key);
    }
  }
}

/** The single shared limiter for the deployed server (server.ts). */
export function createDefaultRateLimiter(): RateLimiter {
  return new RateLimiter();
}
