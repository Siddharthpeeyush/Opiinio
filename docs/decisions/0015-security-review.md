# 0015 — Layer 10: security review

Status: Accepted for V1. Implemented locally, NOT pushed (the
batch push_files route is 403-broken for this repo; single-file
create_or_update_file works — keep new files few and smallish,
per the task). No live Supabase call, no users created, no
providers enabled live, no key invented or requested. Zero new
runtime dependencies; zero new dev dependencies.

## Context

The playbook ("Harden the product") requires a threat model,
a pre-release security review (broken access control,
injection, XSS, CSRF, open redirects, SSRF, insecure uploads,
secrets in code/logs, security headers, verbose errors,
insecure cookies), a dependency audit, field encryption,
redacted logs, account deletion, a data export feature, rate
limits (done in Layer 11), and an abuse review.

Opiinio adaptations, recorded honestly:

- **No uploads exist** (text-only V1), so insecure-upload and
  file-serving reviews are not applicable.
- **No cookies, no payments, no webhooks, no paid APIs** — so
  insecure-cookie, payment-webhook, and API-quota reviews are
  not applicable. **CSRF is a non-threat by construction:**
  auth is Bearer in the Authorization header, there is no
  ambient credential (no cookie), and CORS is same-origin
  only — a cross-site page cannot mint the header. Stated
  explicitly, not assumed.
- **No SSRF surface:** the only server-side fetches are to
  the configured Supabase URL (GoTrue + PostgREST), and
  request URLs are never built from user input.
- **Open redirects:** none found — the app builds no
  redirect URLs from user input; Google OAuth start returns
  the GoTrue authorize URL for this project only, with no
  `redirect_to` invented.
- **Field encryption:** no encrypted-field layer added in
  V1. The sensitive fields (email, password) live in Supabase
  Auth, not in this app's tables; MFA secrets are shown once
  and discarded. Recorded as reviewed-and-deferred, not
  omitted by accident.
- **Account deletion:** deliberately NOT built here. The
  route is aal-gated and 403 SERVER_ONLY in
  src/routes/auth.ts (needs the admin API + service_role
  key, never wired into this repo). A future admin layer —
  dashboard delete or a server-only function holding the key
  OUTSIDE this codebase — is the only honest path. Restated,
  not re-solved.

## Decisions

- **Threat model: `docs/security-threat-model.md`.** Assets
  (identities, anonymous opinions, votes, private tables, MFA
  factors, the public-by-design anon key), trust boundaries
  (browser → app server → GoTrue/PostgREST), and a
  STRIDE-lite table per entry point with likelihood, impact,
  mitigations present, and mitigations missing. The
  direct-PostgREST anonymous-masking bypass is restated as
  the largest open item — the app API is the only masked
  read path, and a hardening decision (server-only
  view/function for anonymous rows) is still owed.
- **Dependency audit (this layer, actual):** zero runtime
  dependencies — the deployed server runs plain Node stdlib
  only, so there is nothing to compromise at runtime. 6
  dev-only deps (typescript, eslint, prettier,
  typescript-eslint, @eslint/js, @types/node), pinned by a
  committed `package-lock.json` (124 packages); CI runs
  `npm ci`. `npm audit --offline` (cached advisories):
  **0 vulnerabilities**. Recorded honestly: the offline run
  uses cached advisory data, not a fresh fetch.
- **Log redaction (reviewed + tested):** `src/lib/log.ts` is
  redacted BY CONSTRUCTION — the `LogEntry` type exposes only
  requestId, route pattern, method, status, userId. There is
  no parameter a credential could arrive on. Proven in
  `tests/security.test.ts`: a fake login payload's email and
  password never appear in a captured log line, and the
  serialized line has exactly the allowed key set.
- **Data export: `GET /api/account/export`.** Privacy-right
  feature, own data only: profile, opinions, replies,
  opinion_votes, opinion_likes, reply_likes, reposts,
  follows (both directions, labelled), polls with embedded
  options, poll_votes, bookmarks, muted_topics,
  muted_words, blocks, reports, notifications. Every table is
  filtered by the caller's own id; 500 rows per table before
  the table is named in `truncated`. Auth-first (401 when
  signed out), the dispatch-level Layer 11 limiter applies
  (GET → read bucket), generic 503 when unconfigured, no
  user id accepted from the caller. The caller's OWN
  anonymous opinions are included (is_anonymous preserved) —
  that is their own data. Documented in
  `docs/api-conventions.md`.
- **XSS sweep of `public/app.js` (this layer, actual):** every
  innerHTML sink audited. All user-controlled fields go
  through `esc()` (opinion id/body/topic, author
  names/handles/initials, poll option text, reply bodies,
  quote takes, muted words/topics, factor names). The one
  raw sink — the GoTrue-provided MFA QR SVG — is now
  guarded by `safeSvg()`: SVG-only, no `<script`, no
  event-handler attributes, no `javascript:` URLs, no
  `<foreignObject>`/`<iframe>`. Counts are numeric
  (`Math.round` in `pct()`) or text-context concatenation —
  no attribute injection.

## Alternatives considered

- **Encrypting opinion bodies at rest:** rejected for V1 —
  the app needs plaintext to serve and search them, and the
  sensitive fields (credentials) already live in Supabase
  Auth. Encryption would add a key-management burden with no
  threat answered. Revisit if a compliance regime requires it.
- **Sanitizing SVG with a library (e.g. DOMPurify):**
  rejected — new dependency for one allow-list check; the
  hand-rolled `safeSvg()` covers the five active-content
  patterns and is behaviourally tested against the shipped
  source. Revisit if QR rendering ever needs richer markup.
- **A separate /api/export route family or paginated
  export:** rejected — one GET route with per-table caps is
  enough at V1 scale; pagination for exports is a later
  optimisation if accounts grow past the caps.

## Verified this layer

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm test` — **171/171** (159 pre-existing green + 12 new
  in `tests/security.test.ts`: 3 log-redaction, 7 export,
  2 safeSvg).
- Secret scanner (`node scripts/scan-secrets.mjs`) — clean
  on the tree (79 files).
- Local server proof (PORT=3102, no env): `/api/health`
  → 200; `GET /api/account/export` with a token → 503
  generic (no variable name); without a token → 503
  (unconfigured); `/api/docs` → 404. The 401-when-signed-out
  case is proven in the mocked route test.
- XSS sweep: grep over `public/app.js` for
  innerHTML/outerHTML/document.write/eval — no outerHTML,
  no document.write, no eval; every innerHTML sink audited
  (listed above).

### Bug found and fixed during this layer's verification

The new export tests exposed a real inconsistency in
`src/routes/api.ts` `resolveCaller()`: on an unconfigured
server, a request WITH a Bearer token fell through to a
misleading 500 (the plain Error from `getAuthConfig` was
re-thrown), while a request WITHOUT a token correctly got
503 from `makeStore`. The fix maps the missing-config case
to the generic 503 in `resolveCaller` too — mirroring
`makeStore` and the auth-route behavior in `src/routes/auth.ts`.
The variable name never leaves the server in either path.
Recorded as a bug-first fix: the failing test came first,
then the fix, then the suite green.

## Follow-ups recorded (not this layer)

- **Penetration test** — not done; out of scope for V1.
- **E2E security testing** — needs staging + real users.
- **Live RLS proof** — two real Auth users, AUTH-SETUP-GUIDE
  §5; mocked tests prove route logic, not live RLS.
- **Anonymous-masking hardening decision** — server-only
  view/function for anonymous rows, before launch.
- **Full GitHub history secret scan** — pre-launch, per 0014.
- **Shared-IP false positives** on rate limits — unproven
  until real users arrive (watch-signal in 0013).
- **Account deletion completion** — future admin layer only.
- **Production tuning of rate-limit buckets** — after real
  traffic (0013).

## Honest gaps / not fully enforceable here

- The offline `npm audit` uses cached advisory data; a
  fresh audit with network access could see newer
  advisories. The residual risk is small (dev-only deps,
  zero runtime deps) and is named, not hidden.
- `safeSvg()` is a hand-rolled allow-list, not a full
  sanitizer library. It blocks the known active-content
  patterns; an exotic SVG vector it does not know about is
  a residual risk. The QR comes from GoTrue over the
  server-to-server path, so the exposure requires a
  compromised GoTrue response.
- The export caps each table at 500 rows (named in
  `truncated`); an account past that needs a paginated
  export, not yet built.
- This layer does not change the direct-PostgREST bypass:
  rate limits and export bind the app routes, not a caller
  holding the anon key against PostgREST directly.
