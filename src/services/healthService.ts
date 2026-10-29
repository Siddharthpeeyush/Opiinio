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

export type ComponentHealthStatus = "not_configured" | "not_checked";

export interface ComponentHealth {
  /**
   * Honesty rule (Layers 3–4, still in force): this is NEVER "ok"
   * for Supabase in these layers.
   * - "not_configured": SUPABASE_URL or SUPABASE_ANON_KEY is missing.
   * - "not_checked": both are present, but no live probe exists yet
   *   (auth verification exists in lib/auth.ts, but no route calls
   *   it against a live GoTrue in this layer, by design).
   * A real probe with a timeout belongs to the layer that wires a
   * live check; claiming "ok" here without one would be a fake check.
   */
  status: ComponentHealthStatus;
  configured: boolean;
  /** Planned probe timeout in ms for the future live check. Not used yet. */
  timeoutMs: number;
}

/** Backwards-compatible alias for the Layer 3 name. */
export type DatabaseHealthStatus = ComponentHealthStatus;
export type DatabaseHealth = ComponentHealth;
export type AuthHealth = ComponentHealth;

export interface LocalComponentHealth {
  status: "ok";
}

export interface RateLimiterHealth extends LocalComponentHealth {
  /** The store behind the limiter. No counts, no keys — never user data. */
  store: "in-memory";
}

export interface ConfigHealth extends LocalComponentHealth {
  appEnv: string;
}

export interface HealthCheck {
  /** Overall: "ok" while the process answers; "degraded" reserved
   * for the layer that adds live probes (a failing probe must be
   * able to move this). Never faked "ok" for unchecked components. */
  status: "ok" | "degraded";
  /** Scaffold-scope only: the app process itself. */
  scope: "app";
  /** development | staging | production — from APP_ENV. */
  appEnv: string;
  /** Names of optional env vars present (never values). */
  envPresent: string[];
  checks: {
    app: LocalComponentHealth;
    config: ConfigHealth;
    rateLimiter: RateLimiterHealth;
    database: ComponentHealth;
    auth: ComponentHealth;
  };
  uptimeSeconds: number;
  timestamp: string;
}

export function buildHealth(env: EnvConfig): HealthCheck {
  const configured =
    env.presentOptional.includes("SUPABASE_URL") &&
    env.presentOptional.includes("SUPABASE_ANON_KEY");
  const component: ComponentHealth = {
    status: configured ? "not_checked" : "not_configured",
    configured,
    timeoutMs: 3000,
  };
  return {
    status: "ok",
    scope: "app",
    appEnv: env.appEnv,
    envPresent: env.presentOptional,
    checks: {
      app: { status: "ok" },
      config: { status: "ok", appEnv: env.appEnv },
      rateLimiter: { status: "ok", store: "in-memory" },
      database: { ...component },
      auth: { ...component },
    },
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
