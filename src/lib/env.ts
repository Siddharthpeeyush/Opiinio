/**
 * Environment validation.
 *
 * Hard rule 7 (AGENTS.md): the app must refuse to start with a
 * clear message if a required variable is missing. Enforcement
 * is environment-aware:
 *
 * - development (default) and staging: Supabase vars are optional;
 *   the app boots in labelled preview mode (routes return generic
 *   503 until configured). Nothing is faked as live.
 * - production: SUPABASE_URL, SUPABASE_ANON_KEY, and APP_ORIGIN
 *   are REQUIRED, and placeholder/example values are refused.
 *
 * Messages name the variable ONLY — values (which may be secrets)
 * are never echoed, in line with the standing privacy rule.
 */

export type AppEnv = "development" | "staging" | "production";

export interface EnvConfig {
  port: number;
  nodeEnv: string;
  appEnv: AppEnv;
  /** Names of optional variables that are present (values never logged). */
  presentOptional: string[];
  /** Single allowed CORS origin for the API (APP_ORIGIN, Layer 5). */
  appOrigin: string | undefined;
}

const OPTIONAL_VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "APP_ORIGIN"] as const;

/** Required in production only (see module doc). */
const PRODUCTION_REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "APP_ORIGIN",
] as const;

const APP_ENVS: readonly AppEnv[] = ["development", "staging", "production"];

/**
 * Placeholder/example values that must never boot production.
 * Substring match on the lower-cased value: real Supabase URLs,
 * JWTs, and deployed origins never contain these tokens.
 */
const PLACEHOLDER_TOKENS = ["your-", "example", "changeme", "placeholder", "<", ">"];

export function isPlaceholderValue(value: string): boolean {
  const lowered = value.toLowerCase();
  return PLACEHOLDER_TOKENS.some((token) => lowered.includes(token));
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const rawPort = env.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid PORT: "${rawPort}". Set PORT to a number between 1 and 65535.`,
    );
  }

  const nodeEnv = env.NODE_ENV ?? "development";

  const rawAppEnv = env.APP_ENV ?? "development";
  if (!(APP_ENVS as readonly string[]).includes(rawAppEnv)) {
    throw new Error(
      `Invalid APP_ENV: "${rawAppEnv}". Set APP_ENV to one of: development, staging, production.`,
    );
  }
  const appEnv = rawAppEnv as AppEnv;

  if (appEnv === "production") {
    for (const name of PRODUCTION_REQUIRED_VARS) {
      const value = env[name];
      if (value === undefined || value === "") {
        // Generic message: names the variable, never the value.
        throw new Error(
          `Missing required environment variable: ${name} (required in production).`,
        );
      }
      if (isPlaceholderValue(value)) {
        throw new Error(
          `Invalid value for environment variable: ${name} (placeholder values are not allowed in production).`,
        );
      }
    }
  }

  const presentOptional = OPTIONAL_VARS.filter(
    (name) => env[name] !== undefined && env[name] !== "",
  );
  const appOrigin =
    env.APP_ORIGIN !== undefined && env.APP_ORIGIN !== "" ? env.APP_ORIGIN : undefined;
  return { port, nodeEnv, appEnv, presentOptional, appOrigin };
}
