#!/usr/bin/env node
/**
 * Opiinio load test (final layer) — zero dependencies, plain node.
 *
 * Hammers the server's public read routes and reports p50/p95/p99
 * latency, throughput, and error counts. Pure helpers
 * (parseArgs, percentile, summarize) are exported so the test
 * suite can prove them without running a server.
 *
 * What it proves: single-process localhost throughput/latency of
 * THIS codebase's request path (routing, validation, rate
 * limiter, JSON serialization). What it does NOT prove: real
 * network latency, Supabase/PostgREST latency (no env here —
 * /api/* returns generic 503s in preview mode), multi-instance
 * behaviour, or write-path load. The staging load test (see
 * docs/pre-launch-checklist.md) is the one that proves those.
 *
 * Usage:
 *   node scripts/load-test.mjs [--url http://localhost:3000]
 *     [--concurrency 20] [--duration 15]
 *     [--routes /, /app.js, /api/health, /api/opinions]
 */

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

export function parseArgs(argv) {
  const out = {
    url: "http://localhost:3000",
    concurrency: 20,
    durationSec: 15,
    routes: ["/", "/app.js", "/api/health", "/api/opinions"],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") out.url = String(argv[++i] ?? out.url);
    else if (arg === "--concurrency")
      out.concurrency = Math.max(1, parseInt(String(argv[++i]), 10) || 1);
    else if (arg === "--duration")
      out.durationSec = Math.max(1, parseInt(String(argv[++i]), 10) || 1);
    else if (arg === "--routes")
      out.routes = String(argv[++i] ?? "")
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.startsWith("/"));
  }
  if (out.routes.length === 0) out.routes = ["/"];
  return out;
}

/** Nearest-rank percentile over an ASCENDING-sorted array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function summarize(name, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    name,
    count: sorted.length,
    meanMs: sorted.length === 0 ? 0 : sum / sorted.length,
    minMs: sorted.length === 0 ? 0 : sorted[0],
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
  };
}

async function worker(baseUrl, routes, deadlineMs, perRoute, errors) {
  let i = 0;
  while (performance.now() < deadlineMs) {
    const route = routes[i % routes.length];
    i += 1;
    const start = performance.now();
    try {
      const res = await fetch(baseUrl + route);
      // Drain the body so the timing includes full transfer.
      await res.arrayBuffer();
      const ms = performance.now() - start;
      perRoute.get(route).push(ms);
      if (res.status >= 500) {
        errors.set("http5xx", (errors.get("http5xx") ?? 0) + 1);
      } else if (res.status >= 400) {
        errors.set("http4xx", (errors.get("http4xx") ?? 0) + 1);
      }
    } catch {
      errors.set("fetch_error", (errors.get("fetch_error") ?? 0) + 1);
    }
  }
}

async function main() {
  const { url, concurrency, durationSec, routes } = parseArgs(process.argv.slice(2));
  const perRoute = new Map(routes.map((r) => [r, []]));
  const errors = new Map();
  const deadlineMs = performance.now() + durationSec * 1000;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, () =>
      worker(url, routes, deadlineMs, perRoute, errors),
    ),
  );
  const elapsedSec = (performance.now() - started) / 1000;
  const all = [...perRoute.values()].flat();
  const total = all.length;
  console.log(
    JSON.stringify(
      {
        url,
        concurrency,
        durationSec: Number(elapsedSec.toFixed(1)),
        totalRequests: total,
        requestsPerSec: Number((total / elapsedSec).toFixed(1)),
        errors: Object.fromEntries(errors),
        overall: summarize("overall", all),
        perRoute: routes.map((r) => summarize(r, perRoute.get(r))),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
