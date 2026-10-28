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

export interface HealthCheck {
  status: "ok";
  /** Scaffold-scope only: the app process itself. */
  scope: "app";
  /** Names of optional env vars present (never values). */
  envPresent: string[];
  uptimeSeconds: number;
  timestamp: string;
}

export function buildHealth(env: EnvConfig): HealthCheck {
  return {
    status: "ok",
    scope: "app",
    envPresent: env.presentOptional,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
