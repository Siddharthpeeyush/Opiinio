# 0013 — Layer 11: rate limits + live reply-like fix

Status: Accepted for V1. Implemented locally, NOT pushed (no
GitHub push in this step, per the task). No live Supabase call,
no users created, no providers enabled live, migration 05 still
file-only, anon key still pending. Zero new runtime
dependencies.

## Context

The playbook (skill `real_saas_playbook`, Layer 11: security
review + abuse review) requires rate limiting before launch,
with the strictest limits on auth endpoints (5 login attempts
per 15 minutes). The live-list pass (decision 0012) also left
one explicit branch behind: the global reply-like handler in
`public/app.js` toasted "preview only" even in live mode.

## Decision

- **New `src/lib/rateLimit.ts`: fixed-window, store-behind-an-interface.**
  `RateLimitStore.consume(key, limit, windowMs)` is an interface;
  the shipped store is `InMemoryRateLimitStore` (single process,
  capped at 10k keys with lazy expiry sweep). A shared store
  (Redis / Upstash / any counter) replaces the implementation
  without rewriting any route — that replacement is the
  recorded multi-instance follow-up below, not this layer.
- **Buckets (why each number).**

  | Bucket                                                                                                                  | Limit       | Why                                                       | What legitimate use still allows                                                                            |
  | ----------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
  | `authStrict` (signup, signin, password reset)                                                                           | 5 / 15 min  | Playbook rule; blocks credential stuffing and signup spam | 5 attempts per quarter-hour per account+IP — a real user who mistypes a password is fine; beyond that, wait |
  | `authGeneral` (refresh, Google start, MFA enroll/challenge/verify, session, factors, password change, account deletion) | 20 / 15 min | Stops session-refresh and MFA-guessing loops              | Normal MFA setup/verify flows, password changes                                                             |
  | `write` (opinions, replies, votes, likes, reposts, follows, reports)                                                    | 60 / 5 min  | Stops opinion/reply spam bursts                           | 12 writes/min sustained — far above a human typing 280-char posts                                           |
  | `read` (feed, post, notifications, profiles)                                                                            | 300 / 5 min | Stops scraping/hammering                                  | 1 read/sec sustained; the SPA's normal loader traffic is well under this                                    |
  | `search`                                                                                                                | 60 / 5 min  | Search is scannable, so stricter than general reads       | Normal human searching                                                                                      |

  These are starting values, not tuned values: production
  tuning after real traffic is owed (listed below), and the
  bucket table is one constant away from a change.

- **Keying: user id first, hashed IP only as fallback.**
  Authenticated routes key by `user:<id>`. Unauthenticated
  routes key by `ip:<sha256(IP)>`. The strict auth routes key
  by BOTH `email:<sha256(lowercased email)>` AND the hashed IP,
  and both must pass — the email key stops targeted stuffing
  against one account, the IP key stops a spray from one
  address. Raw IPs and emails are NEVER stored, logged, or
  returned: they are SHA-256-hashed (domain-separated) before
  becoming part of a key.
- **429 contract (privacy).** Exceeding a limit throws a generic
  `ApiError(429, "RATE_LIMITED", "Too many attempts, try again
later", retryAfterSeconds)`; both route families add the
  `Retry-After` header. The body is the single generic error
  shape with no email, no IP, no account name — and crucially
  no "account exists / does not exist" signal, so a 429 is not
  an enumeration oracle. Logs carry route + status only
  (no keys, counts, or windows). The denied request never
  reaches GoTrue or the store.
- **Ordering kept honest.** `/api/*`: route-table 404 first,
  then caller resolution (a presented-but-rejected token is
  401, not 429), then the limiter, then the store. Auth:
  signup/signin/reset parse+validate the body first (cheap,
  no GoTrue), then limit on the hashed email; all
  session-bearing routes resolve the session first (401 on a
  bad token, never 429), then limit on the user id.
- **Sign-out is deliberately NOT limited.** Blocking sign-out
  would trap a user in a session; a rejected token is already
  dead, so limiting adds no security and real harm. Documented
  as an explicit exception, not an oversight.
- **Wiring: production path only.** `server.ts` creates one
  shared `RateLimiter` at startup and passes the direct socket
  IP (`req.socket.remoteAddress`) — X-Forwarded-For is
  spoofable and is never trusted (documented; a
  trusted-proxy header is a recorded future step). `app.ts`
  `route()` threads the limiter into both route families and
  builds the auth adapter (strict routes check email+IP,
  key-less routes check IP only). Direct `handleAuth` /
  `handleApi` calls without injected deps stay un-limited —
  that is test isolation, documented here, not hidden; the
  deployed server always goes through `route()`.
- **Live reply-like fix (the one 0012 branch).** In live mode
  the handler now calls `POST /replies/:id/like` (or `DELETE`
  when `ownLiked` from the server-fetched reply view is true),
  then calls `route()` to re-render — the count is refetched
  from the server, never adjusted by local arithmetic. Failure
  shows the generic toast (`"Could not save your like."`;
  `"Sign in required to like."` on 401). Preview mode keeps
  the exact preview toast.

## Abuse review (playbook requirement)

- **What each limit stops:** credential stuffing (authStrict),
  MFA-guess and session-refresh loops (authGeneral), spam
  bursts and vote brigading (write), scraping and hammering
  (read/search).
- **False positives on shared IPs (college/hostel NAT):**
  the documented trade-off. Keying by user id first means one
  user's hammering never blocks other signed-in users behind
  the same NAT. What remains: (a) unauthenticated callers
  share the IP bucket, so a heavy scraper on a college NAT can
  burn the unauthenticated read budget for others behind it;
  (b) the strict auth bucket deliberately double-keys
  email+IP, so a spray from a shared IP can lock out other
  users' signin attempts from that IP for up to 15 minutes.
  Mitigations in place: per-user buckets stay independent, so
  signed-in use is never collateral; the per-email key keeps a
  targeted victim's budget separate from a spray only in the
  sense that the victim's own signin from a different IP still
  works. Watch for: 429 spikes from campus/hostel IP ranges
  after launch; if real, the remedy is per-user relaxation
  (e.g. larger unauthenticated read budget behind known-good
  behavior) — not removing the strict bucket.
- **No new enumeration surface:** 429s carry no
  account-existence signal; bad tokens are 401 before the
  limiter; unknown paths are 404 before the limiter.

## What was deliberately left unlimited, and why

- **Sign-out** (see above).
- **`/api/health`, `/api/health/live`, served pages/assets,
  `/api/docs` (404).** Health and static serving are cheap,
  unauthenticated by design, and needed by uptime checks; docs
  does not exist (404 before any limiter). A flood here is a
  platform-level concern (Netlify/CDN), not app logic.
- **Direct handler calls without injected deps** (test
  isolation only — the deployed path always limits).

## Verified this layer

- `npm run typecheck`, `npm run lint`, `npm run format:check`
  — all clean.
- `npm test` — 154/154 (135 pre-existing green, 19 new in
  `tests/rate-limit.test.ts`): store fixed-window behavior and
  window reset, key independence, IP/email hashing (raw values
  never in keys), bucket mapping, hook-backed 429 with zero
  additional GoTrue calls, per-user vs per-IP keying, the
  shared-IP trade-off asserted explicitly, write/read limits
  enforced before the store, 429 body carries no personal
  data, route-table 404 precedes limiting, signout never
  limited, route() wiring into both families, and static
  assertions that the reply-like live branch calls
  POST/DELETE `/replies/:id/like` by `ownLiked` and refetches
  via `route()` while the preview toast is byte-identical.
- Live local server (`PORT=3100`, placeholder env so config
  resolution passes, no real Supabase): `/api/health` → 200,
  `/api/docs` → 404, then 7 real signin POSTs — first 5 hit
  GoTrue-unreachable (503, sandbox has no egress), 6th and 7th
  → `429 Too Many Requests` with `Retry-After: 825` and body
  `{"error":{"code":"RATE_LIMITED","message":"Too many attempts,
try again later"}}`. The 429 requests never reached GoTrue.

## Follow-ups recorded (not this layer)

- **Shared/distributed store** for multi-instance deploys
  (Redis/Upstash); the interface boundary is ready, the
  in-memory store is single-process only.
- **Production tuning** of bucket values after real traffic
  (watch for shared-IP false positives).
- **Trusted-proxy header** handling if/when the app sits
  behind a proxy that must be trusted (currently only the
  direct socket address is used).
- **CI/CD, monitoring/alerts, staging/prod** — untouched,
  still owed by later layers.

## Honest gaps / not fully enforceable here

- Without live traffic the bucket numbers are starting
  values; false-positive rates on shared IPs cannot be proven
  until real users arrive.
- The direct-PostgREST anonymous-masking bypass (decision
  0011/0012) is untouched by this layer; rate limits apply to
  the app routes, not to a caller holding the anon key against
  PostgREST directly.
- The reply-like fix is proven statically and against the
  route wiring; a real signed-in like round-trip still needs
  the two live Auth users (dashboard step, owed).
