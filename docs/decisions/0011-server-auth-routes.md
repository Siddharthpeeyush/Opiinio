# 0011 — Server auth routes: /api/auth/\*, GoTrue proxied from the server only

Status: Accepted for V1 (server auth route layer only). No CI/CD,
no rate-limit store, no monitoring, no live Supabase call, no
GitHub push in this step.

## Context

Layer 6 built sign-in / MFA screens that deliberately could not
sign anyone in: there was no /api/auth route, and the frontend
was forbidden from calling Supabase directly (that would bypass
Layer 5 anonymous masking and put the anon key in client code).
This layer closes that gap on the server side, and wires the
Layer 6 screens to it — plus the known Layer 6 Compose gap
(live poll creation made only the opinion call, never the poll
call).

## Decision

- **Server-only GoTrue proxy.** All auth traffic goes through
  `src/routes/auth.ts` (thin handlers) + `src/services/authService.ts`
  (GoTrue calls via global fetch) + the existing Layer 4 helpers
  (`src/lib/auth.ts` verifySession, `src/lib/mfa.ts` TOTP
  helpers). The frontend calls same-origin `/api/auth/*` only
  (proven by test: the only `fetch(` in `public/app.js` is
  `fetch("/api" + path)`); it never builds a Supabase URL, never
  calls PostgREST/GoTrue, and never offers a direct-table path.
- **Zero new runtime dependencies.** Rejected, as in Layers 4–5:
  `@supabase/supabase-js` for the server layer — the server
  needs a handful of GoTrue endpoints, and a dependency for
  that adds surface for no V1 benefit. The frontend likewise
  stays vanilla JS with no client library.
- **Routes** (complete list; documentation lives in this repo
  only — there is no /api/auth/docs, no listing route, and
  unknown /api/auth paths get the generic 404, with the
  route-table check running BEFORE config so a probe cannot
  learn, via a 503, whether a path is "almost" a route):
  - `POST /api/auth/signup` {email, password} → own user +
    session, or `emailConfirmationRequired: true` when GoTrue
    issues no session (Confirm email ON). Signup failures are
    generic 400 — never "email taken".
  - `POST /api/auth/signin` {email, password} → own session.
    Bad credentials are one generic 401 ("Invalid email or
    password") — never "no such email" vs "wrong password".
  - `POST /api/auth/signout` (Bearer) → {signedOut: true}.
    Best-effort GoTrue revocation; a rejected token is already
    dead, so sign-out still succeeds locally. Only a network
    failure is a real failure (503).
  - `POST /api/auth/reset` {email} → {sent: true} whenever
    GoTrue is reachable, even for an unknown email (no
    email-existence oracle). Only validation / network differ.
  - `POST /api/auth/refresh` {refresh_token} → new session;
    expired refresh is a generic 401.
  - `GET /api/auth/session` (Bearer) → own user + `aal`
    (decoded ONLY after GoTrue verified the token, Layer 4
    rule). No token → 401 (when configured).
  - `GET /api/auth/google` → {url} = GoTrue authorize URL
    for this project (`{SUPABASE_URL}/auth/v1/authorize?provider=google`).
    No `redirect_to` is invented here. The Google OAuth
    client's registered redirect URI — the Supabase callback —
    is `https://moahibzipoyyheaceonp.supabase.co/auth/v1/callback`
    for the real project (AUTH-SETUP-GUIDE.md Step 2); that URI
    lives in Google Cloud + the Supabase dashboard, not in a
    query parameter invented by this code. After Google +
    Supabase finish, Supabase redirects to the dashboard Site
    URL (Step 3, the app origin), where the SPA picks tokens
    out of the URL hash once, stores them in sessionStorage,
    and clears the hash. **Google client creation + provider
    enablement remain the user's dashboard steps** — this
    layer does not create them and does not claim they exist.
  - `POST /api/auth/mfa/enroll` (Bearer) → factorId, qrCode,
    secret, uri (TOTP only; secret + QR returned ONCE, to the
    enrolling user only; the frontend discards them after
    verification and never stores/logs them).
  - `POST /api/auth/mfa/challenge` (Bearer) → challengeId.
  - `POST /api/auth/mfa/verify` (Bearer) → {verified, session}
    where session is the upgraded (aal2) session when GoTrue
    issues one. Malformed codes are rejected locally (no
    GoTrue call); wrong codes are a generic 400.
  - `GET /api/auth/mfa/factors` (Bearer) → the caller's own
    factors (id / friendly name / type / status — never a
    secret or code).
  - `DELETE /api/auth/mfa/factors/:id` (Bearer) → aal-gated,
    then unenroll (204).
  - `PATCH /api/auth/password` (Bearer) → aal-gated, then
    GoTrue self-service password change (no admin key needed).
  - `DELETE /api/auth/account` (Bearer) → aal-gated, then
    SERVER_ONLY (see below).
- **Session handling for the SPA.** The server returns the
  GoTrue session in the response body; the frontend stores it
  in sessionStorage only (never persistent browser storage,
  never localStorage), clears it on sign-out, and validates a
  stored session via GET /api/auth/session on boot (401 clears
  it; 503 keeps it for the tab, and the next API call surfaces
  the real error). No session cookie is set to any origin:
  auth is Bearer tokens, not cookies (Layer 5 CORS rule).
- **AAL gating, Layer 4 rule, on every sensitive action.**
  `mayPerformSensitiveAction()` (aal2 required ONLY when the
  user already has a verified TOTP factor; otherwise aal1
  suffices) gates: MFA unenroll, password change, account
  deletion. A stolen password alone must not delete the
  account or unenroll the factor.
- **Rate-limit hooks, not a store.** Layer 11 owns the shared
  store; these routes call an optional `deps.rateLimit` hook
  before GoTrue on signup, signin, reset, refresh, Google
  start, MFA challenge, MFA verify, password change, and
  account deletion, so the limiter can wrap them without a
  rewrite. The default (no hook) is NO limiting — recorded
  honestly here, not hidden. A denying hook produces a
  generic 429 and the request never reaches GoTrue (tested).
- **Missing env → generic 503, never a variable name.**
  Every auth route (including session) returns 503
  SERVICE_UNAVAILABLE when SUPABASE_URL/ANON_KEY are missing
  — except unknown paths, which are 404 by the route-table
  check first. GoTrue unreachable is likewise a generic 503
  (the auth route catch converts AuthUnavailableError, which
  the generic error mapper alone would have turned into a
  misleading 500 — found by a failing test, fixed in code).
- **Frontend wiring in the same pass.**
  - Sign-in screen: real sign-in + sign-up toggle (same form,
    mode in state), password-reset form (oracle-free message),
    Google button (navigates to the server-returned GoTrue
    URL), and a sign-in challenge screen when a verified
    factor + aal1 session is detected after password sign-in
    (challenge → verify → upgraded session → feed).
  - Settings MFA: real enroll (QR/secret shown once, then
    discarded after verification), verify, factor list, and
    unenroll; signed-out users get an auth-required empty
    state, not a fake form.
  - Settings Account: real password-change form (aal-gated
    on the server); delete-account button calls the gated
    route and reports the SERVER_ONLY boundary honestly.
  - Preview mode stays labelled when env is missing: auth
    calls return 503 and no session is ever faked.
  - Compose poll fix (Layer 6 gap 6): in live mode, after
    POST /opinions returns the created opinion, the frontend
    now makes the second call POST /opinions/:id/polls with
    the created id and 2–6 options (≤80 chars each). If the
    poll call fails, the message says the opinion posted but
    the poll did not — never a claim that the poll posted.
    In preview mode, poll creation stays preview-local and
    labelled, as before.
- **Validation at the boundary.** Email format, password
  8–128 characters (matching the Layer 6 form), MFA code
  exactly 6 digits, allowed-keys rejection on every body —
  all with generic messages, never GoTrue raw errors, SQL,
  stack traces, or internal paths. Bodies are capped by the
  Layer 5 64 KB rule via parseJsonBody.

## Alternatives considered

- Browser-direct Supabase Auth (the Layer 6 rejected option):
  rejected again — it would bypass Layer 5 masking and put
  the anon key in client code. Server proxy is the correct
  shape, and it is what this layer builds.
- Faking a local session in preview to "make sign-in work":
  rejected, as in Layer 6 — preview actions stay labelled
  and local; a session exists only when GoTrue issues one.
- Wiring the service_role key to delete GoTrue users:
  rejected outright — the key must never be in this repo,
  in client code, or in logs. See SERVER_ONLY below.
- Adding `redirect_to` to the Google authorize URL:
  rejected for this layer — the dashboard Site URL already
  governs the post-OAuth redirect, and inventing a callback
  parameter would contradict the recorded callback
  (the Supabase callback URL above). If a future layer
  needs a per-environment redirect, it gets its own
  decision record.

## Deliberately left out (with why)

- **Email change route.** Not in this layer's brief; adding
  it would need its own aal-gate decision (Layer 4 flagged it
  as "not gated here; needs a decision record in Layer 5",
  which never landed). Left out, not silently added.
- **Email verification resend route.** GoTrue handles
  verification via the signup confirmation email; a resend
  endpoint is a future, spam-sensitive addition (rate limits
  first), not in this layer.
- **Actual GoTrue user deletion.** See SERVER_ONLY below.
- **Rate-limit store, CI/CD, monitoring.** Other layers
  (Layer 11, Layer 7), not this one. The hook is the only
  rate-limit work here.

## Consequences and honest limits — what this layer cannot enforce alone

1. **Account deletion is gated but NOT completed by this
   route.** DELETE /api/auth/account passes the aal gate,
   then throws 403 SERVER_ONLY: GoTrue user deletion needs
   the admin API + service_role key, which must never be
   wired into this repo. The frontend reports that boundary
   honestly ("needs an admin step") instead of claiming
   deletion. A future admin layer (dashboard delete, or a
   server-only function holding the key outside this
   codebase) owns the actual deletion. Until then, a user
   who "deletes" via this route has NOT had their auth
   account deleted — this must not be described otherwise.
2. **Direct PostgREST anonymous-masking gap (Layer 5) still
   stands.** This layer does not fix it: the frontend still
   never calls PostgREST directly, and the app API remains
   the only masked read path. A future hardening layer must
   still decide whether anonymous opinions move behind a
   server-only view/function.
3. **No rate limits yet (default hook is a no-op).** A valid
   caller can still hammer auth routes until Layer 11 lands
   the shared store. The hook points are in place; the
   enforcement is not.
4. **Live behaviour is mocked, not proven.** All live
   behaviour in this layer is proven with mocked GoTrue
   responses. Live sign-in, Google OAuth, MFA enroll/
   challenge, and the cross-user proof still need: providers
   enabled live (AUTH-SETUP-GUIDE.md Steps 1–3), migration
   05 applied live (Step 4), a local .env with
   SUPABASE_URL/ANON_KEY (never committed), and two real
   Auth users (Step 5). Until then, health still reports
   auth as not_configured/not_checked, never ok.
5. **Feed / notifications / own-profile screens still render
   sample data in the existing Layer 6 code.** This layer's
   brief was auth routes + sign-in/MFA wiring + the Compose
   poll second call; it did not rewrite feed/notifications
   to fetch live lists, and it did not change the
   #/profile/me empty state (which still shows a sign-in
   prompt even when a real session exists). Those are
   Layer 6 leftovers for a follow-up, recorded here rather
   than hidden — a signed-in user can now post, vote, and
   manage MFA through real routes, but the feed screen
   itself still shows its sample list until a live-list
   pass lands.
6. **GoTrue endpoint shapes are as implemented from the
   Supabase Auth API** (signup, token grant types, recover,
   logout, user PUT, factors, authorize) — not proven live
   until the manual proof in AUTH-SETUP-GUIDE.md §§5–6.
   If a live call returns an unexpected shape, the service
   parses defensively to "no session" / generic failure
   rather than fabricating one, and that failure must be
   reported with the exact status, not papered over.
