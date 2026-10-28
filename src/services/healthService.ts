/**
 * Health service — the ONLY business logic in this scaffold step.
 *
 * Route handlers must stay thin: this module builds the health
 * payload, and src/routes/health.ts only formats it as HTTP.
 * No database, cache, or external call happens here yet. The
 * component-level health check (database + cache + jobs, with
 * timeouts) is a later layer, per the skill's operate-and-scale
 * section, and must not be faked here.
 */

import type { EnvConfig } from "../lib/env.js";

export type DatabaseHealthStatus = "not_configured" | "not_checked";

export interface DatabaseHealth {
  /**
   * Layer 3 honesty rule: this is NEVER "ok" in this layer.
   * - "not_configured": SUPABASE_URL or SUPABASE_ANON_KEY is missing.
   * - "not_checked": both are present, but no live probe exists yet
   *   (no Supabase client dependency is wired in Layer 3, by design).
   * A real probe with a timeout belongs to the layer that wires the
   * client; claiming "ok" here without one would be a fake check.
   */
  status: DatabaseHealthStatus;
  configured: boolean;
  /** Planned probe timeout in ms for the future live check. Not used yet. */
  timeoutMs: number;
}

export interface HealthCheck {
  status: "ok";
  /** Scaffold-scope only: the app process itself. */
  scope: "app";
  /** Names of optional env vars present (never values). */
  envPresent: string[];
  checks: { database: DatabaseHealth };
  uptimeSeconds: number;
  timestamp: string;
}

export function buildHealth(env: EnvConfig): HealthCheck {
  const configured =
    env.presentOptional.includes("SUPABASE_URL") &&
    env.presentOptional.includes("SUPABASE_ANON_KEY");
  return {
    status: "ok",
    scope: "app",
    envPresent: env.presentOptional,
    checks: {
      database: {
        status: configured ? "not_checked" : "not_configured",
        configured,
        timeoutMs: 3000,
      },
    },
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
