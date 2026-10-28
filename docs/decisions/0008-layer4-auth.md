# 0008 — Layer 4 auth: Supabase Auth via GoTrue fetch, zero new runtime dependencies

Status: Accepted for V1 (Layer 4 only). No Layer 5 feature APIs, no
frontend screens, no live provider enablement in this step.

## Context

Part 0 locked Supabase Auth (Google + email, no SMS OTP) and the
AGENTS.md rule "ask before adding a dependency". This layer cannot
ask the user in this step, so it records the dependency decision
here instead of silently adding one — and chooses the option that
needs no new dependency at all.

## Decision

- **Server session verification = one GoTrue call, via global
  fetch**: `GET {SUPABASE_URL}/auth/v1/user` with the anon key and
  `Authorization: Bearer <token>`, implemented in
  `src/lib/auth.ts` (`verifySession`). GoTrue accepting the token
  is the proof; a non-2xx response is "no user", and a network
  failure is a distinct `AuthUnavailableError` (503 territory),
  never a silent 401.
- **No local JWT signature verification.** The anon key is not a
  signing secret, so verifying a signature locally with it would
  be fake security. Any future local verification would need the
  JWT secret (never the anon key, never in this repo) and its own
  decision record.
- **No new runtime dependencies.** `package.json` is unchanged.
  The only auth surface in this layer is verification + the
  central permission check + anonymous masking; signup/login
  forms, password-reset emails, and OAuth redirects are Supabase
  Auth's own flows (see `AUTH-SETUP-GUIDE.md`), not code written
  here.
- **Central permission check**: `can()` in
  `src/services/permissions.ts`, matrix in `docs/permissions.md`,
  mirroring migration 04 RLS. Status mapping in `deniedStatus()`
  (`src/lib/auth.ts`): unauthenticated 401, unauthorised 403,
  other-user private row 404.
- **Anonymous masking**: `src/services/anonymous.ts`. RLS does not
  anonymise (migration 04 header); every Layer 5 response must mask
  anonymous authors to "Anonymous" with generic initials "AN".
  Initials are derived at render time, never stored.
- **Profile on signup**: migration 05
  (`supabase/migrations/20261029050000_auth_profile_trigger.sql`),
  NOT applied live in this step. Trigger on `auth.users` insert,
  SECURITY DEFINER (required: a brand-new user has no session for
  the profiles INSERT policy), handle derived from the email
  prefix and sanitised to `^[a-z0-9_]{3,30}$`, with a numeric
  suffix on collision and a `user_<id8>` fallback for short or
  missing prefixes.
- **Health honesty carried forward**: health now reports both
  `checks.database` and `checks.auth` as `not_configured` (vars
  missing) or `not_checked` (vars present, no live probe yet).
  Neither is ever "ok" in this layer.

## Alternatives considered

- `@supabase/supabase-js` (the official client): rejected for this
  server layer — it would be the natural choice for a browser
  client in Layer 6, but the server only needs one verification
  call, and a dependency for one fetch call adds surface for no
  V1 benefit. Layer 6 may revisit this with its own record; the
  decision is not "never use the client", it is "not for this
  server check".
- Local JWT verification with the anon key: rejected outright —
  the anon key cannot verify signatures, so this would pass
  forged tokens.
- Hand-rolled passwords/sessions, SMS OTP: rejected by the
  playbook and by the locked stack (AGENTS.md hard rule 4, ₹0).
- Email + Google only: no phone, no other OAuth providers in V1.

## Addition: TOTP MFA (optional, authenticator app only)

Added after the initial Layer 4 work, at the user's question
"is there any way can we use 2FA login / sign up system" — yes,
and it costs ₹0 extra.

- **TOTP MFA is free and on by default** on every Supabase
  project. It needs no paid add-on, no extra plan, and no new
  dependency: the same GoTrue fetch in `src/lib/mfa.ts` calls
  `/auth/v1/factors` (enroll / challenge / verify / list /
  unenroll) with the user's session token.
- **SMS / phone MFA is explicitly excluded.** It is a paid
  add-on in Supabase and would break the locked ₹0 / no-SMS-OTP
  rule (AGENTS.md hard rule 4). No helper here creates a phone
  factor; `listFactors()` only reports one if it somehow exists.
- **Optional, not mandatory.** MFA is opt-in per user at launch.
  Forcing it would lock out users who lose a device.
- **AAL gating:** `readAalFromVerifiedToken()` decodes aal/amr
  from a JWT payload ONLY after `verifySession()` has accepted
  that token with GoTrue — it never verifies a signature itself
  (see its header warning). `mayPerformSensitiveAction()`
  requires aal2 for delete-account / change-password / unenroll
  ONLY when the user already has an enrolled factor; otherwise
  aal1 is sufficient. A stolen password alone must not delete
  the account or unenroll the factor.
- **No backup codes invented.** Supabase MFA has no built-in
  backup codes. Lost-device recovery is unenroll from an
  authenticated session, or admin unenroll in the Supabase
  dashboard — documented in `AUTH-SETUP-GUIDE.md`, never in
  client code.
- **Frontend still needed (Layer 6):** enroll QR screen,
  verify-code screen, sign-in challenge screen, Settings MFA
  section. This layer provides the helpers and tests only.

## Consequences and honest limits

- Auth providers are NOT enabled live in this step (dashboard
  steps are in `AUTH-SETUP-GUIDE.md`, for the user). Until they
  are, `verifySession` has no real session to verify, and the
  health auth check stays `not_configured` / `not_checked`.
- Live cross-user proof is outstanding: file/mock tests prove
  `can()` and the trigger SQL say the right things; they do not
  prove two real Auth users are blocked live. That proof needs
  two real users and is listed as skipped, with exact steps in
  `AUTH-SETUP-GUIDE.md` §5.
- Live MFA proof is likewise outstanding: mocked tests prove the
  enroll/challenge/verify/unenroll helpers call the right GoTrue
  endpoints with TOTP only; they do not prove a real authenticator
  app enrolls, challenges at sign-in, or unenrolls live. That
  proof is a manual step in `AUTH-SETUP-GUIDE.md` §6.
- Password reset and email verification are Supabase Auth
  behaviours, not code here: reset links expire per Supabase's
  Auth settings (see the guide); this layer adds no custom reset
  token and must never invent one.
- `.env.example` is unchanged: SUPABASE_URL and
  SUPABASE_ANON_KEY remain documented placeholders. Auth code
  fails clearly (`getAuthConfig`) when they are missing, but the
  server itself still starts without them so the landing page
  serves — making them required at startup is a Layer 5 decision,
  when the first real route calls auth.
