# Opiinio — API conventions (Layer 5)

**This document lives in the repo only. It is NOT served by the
app: there is no `/api/docs`, no OpenAPI/spec endpoint, and no
route that lists endpoints.** A caller who guesses a path gets
the same generic 404 as for any unknown path. That hiding is a
privacy decision (docs/decisions/0009-layer5-apis-privacy.md),
not an oversight — the frontend is built from this document, and
external callers are not an audience for V1.

## Base and shape

- Base: `/api`. All bodies are JSON objects. All responses are
  JSON: success is `{ "data": ... }`, failure is the single error
  shape below. There is no other shape.
- Lists are `{ "items": [...], "nextCursor": "<opaque>" | null }`.
  `nextCursor` is an opaque base64url cursor over the last row's
  `(created_at, id)`; callers pass it back as `?cursor=...`.
  There is no offset parameter, and none will be added.

## Single error format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "body must be 1–280 characters" } }
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401),
`FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
`PAYLOAD_TOO_LARGE` (413), `INTERNAL_ERROR` (500),
`SERVICE_UNAVAILABLE` (503), `SERVER_ONLY` (403, server-only
tables), `RATE_LIMITED` (429, Layer 11: body
`{"error":{"code":"RATE_LIMITED","message":"Too many attempts, try again later"}}`
plus a `Retry-After` header in seconds). Messages are generic: no SQL,
no GoTrue raw errors, no stack traces, no internal paths, no tokens.
A 500 body is always
exactly `{"error":{"code":"INTERNAL_ERROR","message":"Internal error"}}`.

## Status rules (playbook + privacy)

- No session on a write, or a presented-but-rejected Bearer
  token on any route → **401**.
- Signed-in user forbidden on a public row (e.g. editing
  another user's opinion) → **403**.
- Signed-in user asking for another user's **private** row
  (bookmarks, mutes, blocks, reports, notifications, own votes)
  → **404**, not 403 and not the data. A 403 would confirm the
  row exists.
- Missing public row → **404**. Duplicate one-per-user row
  (second like, second repost, second poll vote, second follow)
  → **409**.
- A refused CORS origin → **403** with no CORS headers.

## Auth and identity

- Every write requires a session verified by Layer 4
  `verifySession()` (GoTrue `GET /auth/v1/user`). The caller id
  is taken from that verified session **only**.
- **Never** send `user_id`, `author_id`, or `email` in a request
  body or query to claim an identity — services ignore such
  fields (unknown keys are rejected with 400), and a request
  that tries to act as another user gets 403/404 per the rules
  above, never the other user's data.
- Sensitive account actions (delete account, change password,
  unenroll MFA) require `aal2` when the user has an enrolled
  TOTP factor (Layer 4 `mayPerformSensitiveAction()`); with no
  factor enrolled, `aal1` suffices.

## Validation (mirrors migration 01 CHECKs)

| Field                                                                | Rule                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| opinion / reply body, quote take, bio, daily question, report reason | 1–280 characters                                                                        |
| topic, muted topic, muted word                                       | 1–50 characters                                                                         |
| display name                                                         | 1–80 characters                                                                         |
| poll option text                                                     | 1–80 characters, 2–6 options per poll                                                   |
| stance                                                               | `agree` / `neutral` / `disagree` (change allowed)                                       |
| reply side                                                           | `for` / `against` / `neutral`                                                           |
| search query                                                         | at most 100 characters, matches opinion bodies only; topic search is the `topic` filter |
| ids in paths                                                         | UUID-shaped, else 400                                                                   |
| request body                                                         | JSON object only, at most 64 KB, else 400/413                                           |
| unknown fields                                                       | rejected with 400 (no silent drops)                                                     |

Additional API-layer rules (not DB triggers, enforced here):

- **Poll option must belong to its poll.** Voting with an
  option id from another poll is a 400, never a vote.
- **Poll votes are locked.** No update: a cast vote can only be
  undone (DELETE) and then re-cast. Stance votes, by contrast,
  may be changed (PUT-equivalent POST replaces the row).
- **One repost per user per opinion** (plain = `quote_take`
  null, Quote = take 1–280). A second repost is a 409.
- **`is_anonymous` cannot be changed after posting.** Flipping
  it would de-anonymise (or retro-anonymise) a public post.
- **Profile handles are not editable via the API.** Handles
  come from the migration-05 signup trigger; an update that
  includes `handle` is a 400.
- **Pinned opinion must belong to the profile owner**, else 403.
- **Block removes follows both ways** via the migration-02
  trigger; the API does not delete follows itself, so the
  trigger stays the single place that rule lives.
- **Notifications update is mark-read only**: the body must be
  exactly `{"is_read": true}`; any other field, or `false`, is
  a 400.

## Pagination

- `?limit=` defaults to 20, capped at 50 — a larger value is
  silently capped, never honoured (a huge limit is a scrape).
- `?cursor=` is the opaque cursor from the previous page; a
  malformed cursor is a 400.
- Replies support `?sort=best` (Voice Score desc, V1 rule =
  reply like count) or default newest. A voice-score page may
  repeat a row across pages if scores change mid-page — the
  cursor pages on `(created_at, id)`, not on score — so the
  frontend de-duplicates by id. This is a known limitation,
  recorded here rather than hidden.

## Routes (complete list for the frontend; not served publicly)

Public reads (visitor allowed): `GET /api/profiles/:id`,
`GET /api/profiles/:id/opinions`, `GET /api/profiles/:id/reposts`,
`GET /api/opinions`, `GET /api/opinions/:id`,
`GET /api/opinions/:id/replies`, `GET /api/opinions/:id/reposts`,
`GET /api/opinions/:id/polls`, `GET /api/daily-questions`,
`GET /api/daily-questions/:id`.

Writes (session required): `PATCH /api/profiles/:id` (own only),
`POST /api/opinions`, `PATCH /api/opinions/:id` (author only),
`DELETE /api/opinions/:id` (author only),
`POST /api/opinions/:id/replies`,
`POST|DELETE /api/opinions/:id/stance`,
`POST|DELETE /api/opinions/:id/like`,
`POST|DELETE /api/replies/:id/like`,
`POST /api/opinions/:id/reposts`,
`POST /api/opinions/:id/polls` (opinion author only),
`POST|DELETE /api/polls/:pollId/votes`,
`POST /api/follows`, `DELETE /api/follows/:id` (either party),
`GET /api/bookmarks`, `POST /api/bookmarks`,
`DELETE /api/bookmarks/:opinionId` (own only),
`GET|POST /api/muted-topics`, `DELETE /api/muted-topics/:topic`,
`GET|POST /api/muted-words`, `DELETE /api/muted-words/:word`
(own only),
`GET|POST /api/blocks`, `DELETE /api/blocks/:blockedId` (own only),
`GET|POST /api/reports`, `GET /api/reports/:id` (own only),
`GET /api/notifications`, `PATCH /api/notifications/:id`
(mark-read only).

**Deliberately absent (no route, generic 404 if probed):**
`POST /api/notifications`, any write to `/api/daily-questions`,
`GET /api/profiles` (no profile list, no user search — no
enumeration oracle), `GET /api/opinions/:id/votes` (no voter
list — aggregates only, in the opinion object), any route that
returns who voted/liked what, and any "is handle/email taken"
endpoint. Profile discovery (Explore "People to Discover") is
not in Layer 5; it needs its own privacy review before it gets
a route.

## Auth routes (server auth layer, repo-only — same hiding rule)

These routes are NOT a public product surface and are not
served as documentation anywhere. The frontend calls them
same-origin only; it never calls GoTrue/PostgREST directly.

- `POST /api/auth/signup` {email, password} → own user +
  session, or `emailConfirmationRequired: true` when GoTrue
  issues no session. Failures are generic 400.
- `POST /api/auth/signin` {email, password} → own session.
  Bad credentials are one generic 401, never an oracle.
- `POST /api/auth/signout` (Bearer) → {signedOut: true}.
- `POST /api/auth/reset` {email} → {sent: true} whenever
  GoTrue is reachable, even for an unknown email.
- `POST /api/auth/refresh` {refresh_token} → new session.
- `GET /api/auth/session` (Bearer) → own user + `aal`
  (decoded only after GoTrue verified the token).
- `GET /api/auth/google` → {url} = GoTrue authorize URL
  for this project (`{SUPABASE_URL}/auth/v1/authorize?provider=google`).
  The Google client's registered redirect URI is the
  Supabase callback
  `https://moahibzipoyyheaceonp.supabase.co/auth/v1/callback`
  (dashboard + Google Cloud, never invented here); no
  `redirect_to` is added by this code.
- `POST /api/auth/mfa/enroll` (Bearer) → factorId, qrCode,
  secret, uri (TOTP only, shown once, discarded after verify).
- `POST /api/auth/mfa/challenge` (Bearer) → challengeId.
- `POST /api/auth/mfa/verify` (Bearer) → {verified, session}
  (session is the upgraded aal2 session when GoTrue issues one).
- `GET /api/auth/mfa/factors` (Bearer) → own factors only.
- `DELETE /api/auth/mfa/factors/:id` (Bearer) → aal-gated,
  then unenroll.
- `PATCH /api/auth/password` (Bearer) → aal-gated, then
  GoTrue self-service password change.
- `DELETE /api/auth/account` (Bearer) → aal-gated, then
  403 SERVER_ONLY: GoTrue user deletion needs the admin API
  - service_role key, which is never wired into this repo.
    This route does NOT delete the auth account.

Missing SUPABASE_URL/ANON_KEY → generic 503 for every auth
route (unknown paths are 404 first, by the route-table check).
Sessions are returned in the response body for sessionStorage
use only (never localStorage, never a cookie to an arbitrary
origin). Rate-limit enforcement is a later layer; auth routes
call an optional hook so a limiter can wrap them without a
rewrite, and the default hook is a no-op.

## Vote privacy and anonymous masking (response rules)

- Opinions carry stance counts, like/repost/reply counts, and
  **only the caller's own** stance (`ownStance`) and like
  (`ownLiked`). Polls carry per-option counts and **only the
  caller's own** option (`ownOptionId`). No voter list exists
  in any response.
- Anonymous opinions: `author` is exactly
  `{authorId: null, handle: "Anonymous", displayName: "Anonymous",
initials: "AN"}` — in feed, detail, search, quote blocks,
  notifications, replies, Daily answers, and the author's own
  lists. The real author row is not even loaded for anonymous
  response paths. Notifications whose linked opinion is
  anonymous mask their actor the same way.
- Public profiles return handle, display name, bio, stored
  counts, pinned opinion id, and render-time initials only.
  Email, auth metadata, phone, IP, tokens, and MFA material
  never appear in any response.

## Idempotency

- One-per-user rows are enforced by composite PKs / UNIQUE
  constraints (votes, likes, bookmarks, reposts, follows,
  mutes, blocks), so a retried request gets a 409 instead of a
  duplicate row. Retries are safe: they never create a second
  row, and the client can treat 409 as "already done".
- Background jobs (Layer 5 design, not yet run): notification
  creation (server-only, later layer), Daily Question rotation
  (1/day, idempotent by date), trending-rank recomputation
  (hourly, reads only). Jobs are idempotent, retry with
  backoff, and never run inside a request. Notification rows
  are created by the server only — users have no INSERT policy
  on that table, and this layer stubs creation as a 403 rather
  than wiring any server key.

## CORS, headers, logs

- CORS: the single configured origin (`APP_ORIGIN`, default
  `http://localhost:3000`) only, echoed exactly, with
  `Vary: Origin`. Never `*`. No `Access-Control-Allow-Credentials`
  (auth is Bearer, not cookies). Requests without an Origin
  header are not CORS requests; auth still runs.
- Security headers on API responses: `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
no-referrer`, `Cache-Control: no-store`. No `X-Powered-By`,
  no stack fingerprint.
- Logs are structured JSON with request id, route pattern,
  method, status, and user id only. Never tokens, passwords,
  OTP/MFA codes, emails, bodies, query strings, or stack traces.
- No third parties in the API layer: no analytics, trackers,
  or external calls carrying user data. The only external call
  is the app's own Supabase project (PostgREST + GoTrue).
