# 0020 — Netlify Functions adapter for the API

Date: 2026-10-29
Status: accepted

## Context

Decision 0003 chose Netlify free for hosting, and `docs/hosting.md`
described the topology (one Netlify site per environment). But the app is
a long-lived Node server (`src/server.ts`), and Netlify's free tier
serves static files — it cannot run a Node server. The repo had no
`netlify.toml` and no serverless adapter, so deploying the repo as-is
could not serve `/api/*`. This was my miss in the hosting layer: the
topology was documented without verifying the runtime fits the host.

## Decision

- The API runs as a Netlify Function: `src/functions/api.ts`, a thin
  translation layer (Netlify event → `route()` → Netlify response).
  All routing, auth, validation, rate limiting, and privacy rules live
  in `route()` and below; nothing is reimplemented in the adapter.
- `netlify.toml`: build `npm run build` (tsc), publish `public/`
  (CDN-served statics), functions `dist/src/functions`, and a 200 rewrite
  `/api/* → /.netlify/functions/api` so `event.path` is the API path
  `route()` expects.
- The function only answers `/api/*` (anything else → generic 404);
  unconfigured env → generic 503 naming no variable; thrown errors →
  generic 503. Client IP comes from Netlify's infra-set
  `x-nf-client-connection-ip` header (not client-spoofable like
  `X-Forwarded-For`); absent → null → route()'s shared "unknown" bucket.
- The adapter is compiled by tsc like everything else and covered by
  `tests/netlify-function.test.ts` (event mapping, non-API 404,
  env-refusal 503, base64 body decoding — through the real `route()`).

## Follow-up fix (2026-10-30): lazy publicDir()

The first deploy of the function crashed at import time:
`TypeError: The "path" argument must be of type string. Received undefined`
at `join(import.meta.dirname, …)` — Netlify's esbuild bundler leaves
`import.meta.dirname` undefined, and `src/app.ts` evaluated it at module
load. Fix: `PUBLIC_DIR` became a lazily-evaluated `publicDir()`
function (same two-levels-up logic, `process.cwd()` fallback). The
function only serves `/api/*`, which never reads static files, so the
path is never resolved there — but module load must not touch it
regardless. Verified: 200/200 tests (static serving still works via the
server path).

## Follow-up fix 2 (2026-10-30): StoreError 401/403 -> 503

Live incident: `GET /api/opinions` returned cryptic 500 INTERNAL_ERROR.
Root cause chain: PostgREST rejected our service key (401), `listOpinions`
didn't wrap its store call in `mapStoreError` (unlike the other six call
sites), and `mapStoreError` had no 401/403 branch — so the StoreError
propagated to the generic 500. Fix: `listOpinions` now wraps with
`mapStoreError`, and 401/403 from PostgREST map to generic 503
SERVICE_UNAVAILABLE (a rejected service key is a server
misconfiguration, never the client's fault). The frontend already
treats 503 as labelled preview. Regression test in
`tests/api.test.ts` ("store failure mapping"). The key value itself
still needs owner verification in the Netlify dashboard.

## Consequences

- **Rate limiting is weaker on serverless (honest, recorded):** the
  in-memory limiter is per warm function instance, not per process, so
  a burst spread across instances is under-counted on strict per-IP
  buckets. Auth-keyed buckets (user id / hashed email) are unaffected
  in practice. The shared-store follow-up from decision 0013 now also
  covers this; it matters before any adversarial attention.
- Cold starts: small (zero runtime dependencies), acceptable for V1.
- `publish = public/` means the repo root (src/, supabase/, docs/) is
  no longer published — only the static frontend is public.
- Staging/prod topology in `docs/hosting.md` is unchanged; each Netlify
  site now runs this same function with its own env vars.
