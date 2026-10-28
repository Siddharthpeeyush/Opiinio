/**
 * Thin health route handler. Business logic lives in
 * src/services/healthService.ts — this file only maps the result
 * to an HTTP response and a JSON body.
 */

import type { EnvConfig } from "../lib/env.js";
import { buildHealth } from "../services/healthService.js";

export function handleHealth(env: EnvConfig): {
  statusCode: number;
  body: string;
} {
  const health = buildHealth(env);
  return { statusCode: 200, body: JSON.stringify(health) };
}

export function handleLive(): { statusCode: number; body: string } {
  // Lightweight liveness probe for load balancers: no checks at all.
  return { statusCode: 200, body: JSON.stringify({ status: "ok" }) };
}
