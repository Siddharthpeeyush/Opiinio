/**
 * Environment validation (scaffold step).
 *
 * Rule from AGENTS.md: the app must refuse to start with a clear
 * message if a required variable is missing. In THIS scaffold step
 * no variable is required yet, because Supabase is not wired — so
 * this module validates shape only and reports which optional
 * variables are present, by NAME only, never by value.
 *
 * When the next layer wires Supabase, add SUPABASE_URL and
 * SUPABASE_ANON_KEY to REQUIRED_VARS and this module will enforce
 * them at startup. That change is a deliberate, recorded step, not
 * a silent edit.
 */

export interface EnvConfig {
  port: number;
  nodeEnv: string;
  /** Names of optional variables that are present (values never logged). */
  presentOptional: string[];
}

const OPTIONAL_VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"] as const;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const rawPort = env.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid PORT: "${rawPort}". Set PORT to a number between 1 and 65535.`,
    );
  }
  const nodeEnv = env.NODE_ENV ?? "development";
  const presentOptional = OPTIONAL_VARS.filter(
    (name) => env[name] !== undefined && env[name] !== "",
  );
  return { port, nodeEnv, presentOptional };
}
