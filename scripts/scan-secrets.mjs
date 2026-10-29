#!/usr/bin/env node
/**
 * scripts/scan-secrets.mjs — local secret scanner for Opiinio.
 *
 * Fails (exit 1) when a file looks like it contains a real secret:
 * private keys, provider API tokens, service_role key material,
 * JWTs assigned to key/token/secret names, passwords or DB
 * connection strings with non-placeholder values.
 *
 * Privacy: findings report file, line, and pattern label ONLY.
 * The matched secret value is NEVER printed (no secrets in logs).
 *
 * Design notes (calibrated against this repo, Layer 7):
 * - Assignment patterns require a QUOTED string literal value, so
 *   code like `apikey: config.anonKey`, `password: cleanPassword`,
 *   or TS type annotations (`password: unknown`) do NOT trip it.
 * - Values that look like test fakes (dictionary words, runs like
 *   "1234", repeats like "!!!!", short values) are treated as
 *   clean. Known residual risk, documented in
 *   docs/decisions/0014-ci-cd-testing.md: a real secret that
 *   contains a dictionary word could slip past — defense in depth
 *   is this gate plus human review of anything flagged.
 * - Mere mentions of "service_role" in docs/comments are NOT
 *   flagged; only a value (JWT or long quoted string) nearby is.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs [--root <dir>] [paths...]
 *   node scripts/scan-secrets.mjs            # scans the repo tree
 *
 * Exit codes: 0 = clean, 1 = findings, 2 = usage/config error.
 *
 * Zero dependencies. Plain node. This is the pre-commit / CI
 * secret gate for Layer 7 (see docs/decisions/0014-ci-cd-testing.md).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);
const SKIP_FILES = new Set(["package-lock.json"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Placeholder values: never real secrets.
const PLACEHOLDER =
  /^(?:your-|placeholder|example|changeme|changethis|todo-|test-|fake-|dummy-|sample-|mock-|key-here|password|secret|1234|<|\*|x{3,})/i;

// Words / shapes that mark a quoted value as an obvious test fake.
const FAKE_WORDS =
  /password|correct|wrong|test|fake|demo|sample|example|mock|dummy|changeme|secret|admin|user|qwerty|letmein|welcome|hello|world|token|key|abc|pw/i;
const REPEAT_RUN = /(.)\1{3,}|0123|1234|2345|3456|4567|5678|6789|abcd/i;

/** @param {string} value */
function looksFake(value) {
  if (value.length < 12) return true; // too short to be a real key/token
  if (PLACEHOLDER.test(value)) return true;
  if (FAKE_WORDS.test(value)) return true;
  if (REPEAT_RUN.test(value)) return true;
  return false;
}

/**
 * @typedef {{ id: string, re: RegExp, valueIndex?: number, fakeCheck?: boolean }} Pattern
 * valueIndex: capture group holding the secret-looking value.
 * fakeCheck: when true, the value is skipped if it looks like a test fake.
 */

/** @type {Pattern[]} */
const PATTERNS = [
  { id: "private-key", re: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/ },
  {
    id: "github-fine-grained-token",
    re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  },
  { id: "slack-token", re: /\bxox[aboprs]-[A-Za-z0-9-]{10,}/ },
  { id: "stripe-live-key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/ },
  {
    // "service_role" with a value right after it: an assignment to a
    // long quoted string, or a JWT. Mere mentions in docs/comments
    // (e.g. "never wire the service_role key") are NOT flagged.
    id: "service-role-key",
    re: /service[-_ ]?role.{0,12}(?:[:=]\s*['"][A-Za-z0-9._~+/=-]{16,}['"]|eyJ[A-Za-z0-9_-]{10,})/i,
  },
  {
    // Any key/token/secret name assigned a JWT-shaped value.
    id: "jwt-in-assignment",
    re: /\b\w*(?:key|token|secret)\w*\s*[:=]\s*['"]?(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})['"]?/i,
    valueIndex: 1,
    fakeCheck: true,
  },
  {
    // Quoted literal only: `apikey: config.anonKey` (variable) is clean.
    id: "secret-assignment",
    re: /\b(?:api[_-]?key|apikey|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"]([^'"]{4,})['"]/i,
    valueIndex: 1,
    fakeCheck: true,
  },
  {
    // Quoted literal only: `var password = el.value` and
    // `password: unknown` (type annotation) are clean.
    id: "password-assignment",
    re: /\bpassword\s*[:=]\s*['"]([^'"]{4,})['"]/i,
    valueIndex: 1,
    fakeCheck: true,
  },
  {
    id: "db-url-credentials",
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/[^/\s:]+:([^@\s/]{3,})@/i,
    valueIndex: 1,
    fakeCheck: true,
  },
];

/** @param {string} line */
function scanLine(line) {
  /** @type {string[]} */
  const hits = [];
  for (const p of PATTERNS) {
    const m = line.match(p.re);
    if (!m) continue;
    if (p.valueIndex !== undefined) {
      const value = m[p.valueIndex] || "";
      if (value === "") continue;
      if (p.fakeCheck && looksFake(value)) continue;
      if (!p.fakeCheck && PLACEHOLDER.test(value)) continue;
    }
    hits.push(p.id);
  }
  return hits;
}

/** @param {string} dir @param {string[]} out */
async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      await walk(full, out);
    } else if (!SKIP_FILES.has(name) && st.size <= MAX_FILE_BYTES) {
      out.push(full);
    }
  }
}

/** @param {string} file */
async function scanFile(file) {
  /** @type {{ file: string, line: number, id: string }[]} */
  const findings = [];
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return findings;
  }
  if (text.includes("\0")) return findings; // binary — skip
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const id of scanLine(lines[i])) {
      findings.push({ file, line: i + 1, id });
    }
  }
  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  /** @type {string[]} */
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root" && args[i + 1]) {
      root = resolve(args[++i]);
    } else if (args[i].startsWith("--")) {
      console.error(`Unknown option: ${args[i]}`);
      process.exit(2);
    } else {
      paths.push(resolve(root, args[i]));
    }
  }

  /** @type {string[]} */
  let files = [];
  if (paths.length === 0) {
    await walk(root, files);
  } else {
    for (const p of paths) {
      const st = await stat(p).catch(() => null);
      if (!st) {
        console.error(`Not found: ${relative(root, p)}`);
        process.exit(2);
      }
      if (st.isDirectory()) await walk(p, files);
      else files.push(p);
    }
  }
  files.sort();

  /** @type {{ file: string, line: number, id: string }[]} */
  const all = [];
  for (const f of files) {
    all.push(...(await scanFile(f)));
  }

  if (all.length > 0) {
    console.error(`secret-scan: ${all.length} finding(s) — values never printed:`);
    for (const f of all) {
      console.error(`  ${relative(root, f.file)}:${f.line} [${f.id}]`);
    }
    console.error(
      "Do NOT commit. Move the secret to an env var or the Secure Vault, " +
        "delete it from the file, and re-scan.",
    );
    process.exit(1);
  }
  console.log(`secret-scan: clean (${files.length} files scanned)`);
}

main().catch((err) => {
  console.error(
    `secret-scan: internal error: ${String(err && err.message ? err.message : err)}`,
  );
  process.exit(2);
});
