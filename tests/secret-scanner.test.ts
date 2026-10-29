import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// scripts/scan-secrets.mjs, resolved from the compiled test location
// (dist/tests/*.test.js -> repo root -> scripts/).
const SCANNER = fileURLToPath(new URL("../../scripts/scan-secrets.mjs", import.meta.url));

/**
 * Run the scanner against a temp fixture dir. Returns the process
 * exit code plus combined output.
 */
async function runScanner(
  dir: string,
  extraArgs: string[] = [],
): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      SCANNER,
      "--root",
      dir,
      ...extraArgs,
    ]);
    return { code: 0, output: String(stdout) + String(stderr) };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: unknown; stderr?: unknown };
    const asText = (v: unknown): string =>
      typeof v === "string" ? v : v instanceof Buffer ? v.toString("utf8") : "";
    return {
      code: typeof e.code === "number" ? e.code : -1,
      output: asText(e.stdout) + asText(e.stderr),
    };
  }
}

describe("secret scanner (scripts/scan-secrets.mjs)", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "opiinio-scan-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("exits 0 on a clean fixture dir (no false positives on this repo's idioms)", async () => {
    await writeFile(
      join(dir, "clean.ts"),
      [
        "// variable references and type annotations are not secrets",
        "const headers = { apikey: config.anonKey };",
        "function signup(body: { email: string; password: unknown }) {",
        "  return fetch(url, { body: JSON.stringify({ email: body.email, password: body.password }) });",
        "}",
        "// placeholder values are not secrets",
        "const example = { api_key: 'your-api-key-here' };",
        "// fake test fixtures are not secrets",
        'const fixture = { password: "correct-password-123" };',
        "// mere mentions of service_role in comments are not secrets",
        "// the store authenticates with the anon key, never the service_role key",
        "",
      ].join("\n"),
    );
    const { code, output } = await runScanner(dir);
    assert.equal(code, 0, `expected clean scan, got:\n${output}`);
  });

  it("exits 1 on a planted service_role JWT and never prints the value", async () => {
    // The planted "secret" is split across string parts on purpose: if it
    // appeared as one literal line, this very test file would trip the
    // scanner. It is an obviously fake fixture value, never a real secret.
    const jwt = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJyb2xlIjoic2VydmljZV9yb2xlIn0",
      "ZkZBS0UtU0lHTkFUVVJF",
    ].join(".");
    const line = ["SUPABASE_SERVICE", "_ROLE_KEY"].join("") + "=" + jwt;
    await writeFile(join(dir, "planted.env"), line + "\n");
    const { code, output } = await runScanner(dir);
    assert.equal(code, 1, `expected findings, got:\n${output}`);
    assert.ok(!output.includes(jwt), "the scanner must never echo the secret value");
    assert.ok(
      output.includes("service-role-key") || output.includes("jwt-in-assignment"),
      "the finding should be labelled",
    );
    await rm(join(dir, "planted.env"), { force: true });
  });

  it("exits 1 on planted provider tokens and private keys", async () => {
    const aws = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const pem = ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("");
    await writeFile(
      join(dir, "planted2.txt"),
      [`token_line = "${aws}"`, pem].join("\n") + "\n",
    );
    const { code, output } = await runScanner(dir);
    assert.equal(code, 1, `expected findings, got:\n${output}`);
    assert.ok(!output.includes(aws), "the scanner must never echo the secret value");
    await rm(join(dir, "planted2.txt"), { force: true });
  });

  it("exits 1 on a planted password and DB connection string", async () => {
    // Built from parts for the same reason as above: the full
    // `password: "<value>"` line must not appear literally in this file.
    const pwLine = ["pass", "word"].join("") + ': "Tr0ub4dor&3xQ9!mz"';
    const dbLine = "db: postgres://app:" + "K7$mQ2vLp48#zW" + "@db.internal:5432/opiinio";
    await writeFile(join(dir, "planted3.yaml"), pwLine + "\n" + dbLine + "\n");
    const { code, output } = await runScanner(dir);
    assert.equal(code, 1, `expected findings, got:\n${output}`);
    assert.ok(
      !output.includes("Tr0ub4dor&3xQ9!mz"),
      "the scanner must never echo the secret value",
    );
    await rm(join(dir, "planted3.yaml"), { force: true });
  });

  it("exits 2 on an unknown option", async () => {
    const { code } = await runScanner(dir, ["--nope"]);
    assert.equal(code, 2);
  });
});
