# 0009 — Layer 5 APIs: validated, privacy-first, hidden

Status: Accepted for V1 (Layer 5 only). No Layer 6 frontend, no
CI/CD, no rate-limit store, no monitoring, no live Supabase call
in this step.

## Context

The user asked for Layer 5 with two hard rules on top of the
playbook: keep the APIs hidden and not accessible to other
people or leaks, and maintain privacy in every aspect. This
record turns those rules into code, tests, and named gaps —
privacy is not a paragraph here, it is the route table, the
serializers, and the test files.

## Decision

- **Hidden APIs.** No `/api/docs`, no OpenAPI/spec endpoint, no
  endpoint-listing route. Documentation lives only in
  `docs/api-conventions.md` in the repo. Unknown `/api` paths
  return the same generic 404 as any unknown path.
- **Auth first, always.** Every write requires a Layer 4
  verified session. Identity comes from that session only;
  `user_id` / `author_id` / `email` in a body or query are
  rejected (unknown keys) or ignored — never trusted. A
  presented-but-rejected Bearer token is a 401 even on a
  public read.
- **`can()` on every route** (`src/services/permissions.ts`),
  before any store call: unauthenticated 401, forbidden on a
  public row 403, other-tenant private row 404 (existence not
  leaked).
- **Private tables own-only, always:** bookmarks, muted topics,
  muted words, blocks, reports, notifications. Lists filter by
  the caller's id; single reads use the private-404 rule; no
  function accepts a user id from the caller for these tables.
- **Vote privacy:** aggregates only. Opinions carry counts plus
  the caller's own stance/like; polls carry per-option counts
  plus the caller's own option. No voter-list route exists, and
  no serializer builds one.
- **Anonymous masking in every response path**, via
  `src/services/serializers.ts` + `src/services/anonymous.ts`:
  author_id null, "Anonymous", initials "AN" — in feed, detail,
  search, quote blocks, notifications (actor masked when the
  linked opinion is anonymous), replies, Daily answers, and the
  author's own lists. Anonymous author rows are not even loaded
  for response paths.
- **No personal data in responses:** public profiles return
  handle, display name, bio, stored counts, pinned opinion id,
  and render-time initials only. Email, auth metadata, phone,
  IP, tokens, MFA material never appear.
- **No secrets:** the store uses the anon key + the caller's
  session token (so RLS still applies). The service_role key
  appears nowhere in code, `.env.example`, or tests except a
  warning string telling the user never to paste it.
  Notification creation is stubbed as a 403 (`SERVER_ONLY`),
  not wired.
- **Redacted logs, generic errors:** structured JSON logs with
  request id, route pattern, method, status, user id only.
  Error bodies are the single generic shape — no SQL, GoTrue
  raw errors, stack traces, or internal paths.
- **CORS + headers:** single configured origin (`APP_ORIGIN`,
  default `http://localhost:3000`), never `*`, no credentials
  header (Bearer auth, not cookies). Security headers on API
  responses; no `X-Powered-By`.
- **No third parties** in the API layer: no analytics,
  trackers, or external calls carrying user data. The only
  external calls are the app's own Supabase PostgREST + GoTrue.
- **No enumeration oracles:** no profile list, no user search,
  no "is handle/email taken" endpoint. Handle collisions stay
  with the migration-05 fallback.
- **Data minimisation:** every query names its columns
  explicitly (`COLUMNS` in `src/db/store.ts`). No SELECT \*.
- **Zero new runtime dependencies.** The store is global fetch
  to PostgREST, as Layer 4 did with GoTrue. Rejected: adding
  `@supabase/supabase-js` for the server layer (one fetch
  surface does not justify it; Layer 6 may revisit for the
  browser client with its own record).
- **Cursor pagination only**, capped at 50 (default 20).
  No offset enumeration.
- **Health unchanged:** app-scope only, auth/database
  `not_configured` / `not_checked`, never `ok` in this layer,
  no new detail.

## Deliberately left out (with why)

- **Profile list / user search / Explore "People to
  Discover".** A ranked people list is a feature, not an
  oracle, but it needs its own privacy review (what ranking
  signals are shown, whether blocked/muted users appear)
  before it gets a route. Layer 5 ships without it.
- **Notification creation, daily-question creation.** Both
  are server-only tables. Creation is stubbed, not wired,
  until a later layer owns the server key and the job design.
- **Rate-limit store (Layer 11).** Pagination caps, search
  length limits, and 64 KB body limits are the Layer 5
  anti-scrape measures; a shared rate-limit store with
  429 + Retry-After is explicitly a later layer.
- **Batch author loading.** List endpoints load authors
  one by one (N+1 at launch scale). Acceptable now, flagged
  as the first optimisation when lists grow.

## Consequences and honest limits — what Layer 5 cannot enforce alone

1. **RLS is still the backstop, not the proof.** File/mock
   tests prove `can()` + serializers say the right things;
   they do not prove live RLS blocks a direct table reader.
   The live cross-user proof (AUTH-SETUP-GUIDE.md §5, two real
   users) is still pending, and it must pass before any
   endpoint is called production-ready.
2. **Direct PostgREST access bypasses masking.** A caller
   with the anon key who queries the Supabase REST endpoint
   directly (not through this app) can still see author_id
   on an anonymous opinion, because RLS grants public SELECT
   on opinions. This app's API is the only masked read path;
   hiding the anon key from browsers is impossible (it is a
   client-safe key), so a future hardening layer must decide
   whether anonymous opinions move behind a server-only view
   or a dedicated function. This is the largest remaining
   privacy gap, and it is recorded here rather than hidden.
   Layer 6 must never offer a "view raw" or direct-table
   path, and must route every read through these endpoints.
3. **CORS is a browser policy, not auth.** A non-browser
   caller ignores CORS entirely; the real protection is
   `verifySession()` + `can()` on every route, which does
   not depend on Origin. The CORS rule stops browser-based
   cross-origin reads; it does not stop a determined script
   with a stolen token, and nothing in this layer claims it
   does.
4. **Rate limits are not yet enforced.** A caller with a
   valid token can still hammer reads within the pagination
   caps. Layer 11 must add the shared store, strictest on
   login/signup/reset, before launch.
5. **Voice-score sort paging may repeat rows** if scores
   change mid-page (cursor pages on `(created_at, id)`).
   Frontend de-duplicates by id; a score-aware cursor is a
   later optimisation.
6. **Providers are still not enabled live, migration 05 is
   still file-only, no users exist, no key has been shared.**
   No live Supabase call was made in this layer, by design.
