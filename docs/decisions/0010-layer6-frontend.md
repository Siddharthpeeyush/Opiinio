# Decision 0010 — Layer 6: editorial frontend

## Context

Layer 5 gave the app validated, hidden, privacy-first APIs
(docs/api-conventions.md, docs/decisions/0009-layer5-apis-privacy.md).
Layer 6 builds the screens those APIs serve, in the approved light
editorial paper look only. The demo prototype artifact is NOT reused:
this frontend is a new single-page app in `public/` (vanilla JS, no
framework, no dependencies) that talks only to same-origin `/api/*`.

## Decision

- Single-page app with hash routes (`#/welcome`, `#/feed`,
  `#/post/:id`, `#/explore`, `#/debates`, `#/notifications`,
  `#/profile/:id`, `#/compose`, `#/settings`, `#/signin`,
  `#/onboarding`), served by the same modular monolith. The server
  change is minimal: `src/app.ts` now also serves `/app.js`.
- Preview mode, labelled, never faked: when `/api/opinions` is
  unavailable (503 unconfigured, or any failure), the app shows
  sample content under a banner that says it is a preview, and
  preview actions are local-only with a "Preview only — not saved"
  notice. Sample posts/authors/counts are never presented as real.
- Authenticated writes are PARTIAL in this layer (see Gaps): there
  is no `/api/auth` route in Layer 5, and the frontend never calls
  Supabase/GoTrue directly (that would bypass anonymous masking),
  so sign-in and MFA screens exist with forms, validation, and
  auth-required / not-connected states, but no live session is
  ever created by Layer 6 forms. No token is stored by them.
- Language toggle changes UI chrome only (English / Hindi strings
  for nav and tagline). It never translates another user's post:
  no paid translation API, per the ₹0 rule. This is stated in the
  footer, in the toggle toast, and in the code header.
- No profile list / user search / People to Discover: Layer 5
  deliberately has no such route, pending a privacy review. The
  Explore screen says so plainly instead of inventing one.

## Alternatives considered

- A framework (React/Vite): rejected for V1 — the scaffold is a
  zero-dependency Node app, and a build step would add toolchain
  risk for screens that vanilla JS serves. Revisit if the screen
  count grows past ~20 or state becomes unmanageable.
- Calling Supabase Auth directly from the browser for sign-in/MFA:
  rejected — it violates the standing privacy rule (direct
  PostgREST/GoTrue bypasses the Layer 5 masked read path) and
  would put the anon key in client code. A server auth route is
  the correct later step, not a browser call.
- Faking a local session in preview (e.g. a "demo user" token):
  rejected — it would present preview actions as real account
  actions. Preview actions stay local and labelled.

## Consequences

- Every view has loading / empty / error / success states,
  including auth-required, no-posts, no-notifications, no-reposts,
  failed-load, and form-validation states.
- WCAG 2.1 AA effort: system fonts with ink-on-paper contrast,
  visible focus outlines, labels on every input, aria-pressed /
  aria-selected on stance and tabs, aria-live status regions,
  skip link. A live screen-reader / keyboard audit is still owed.
- Responsive: single-column feed, `minmax(0, 1fr)` grids,
  `flex-wrap` post heads, `overflow-wrap: anywhere`. The earlier
  Welcome-overflow / feed-grid bug is addressed by those rules
  plus a 640px breakpoint — but a live 390px / 1440px scrollWidth
  check is still owed (see Gaps), because these tests are static
  and do not measure layout.

## Gaps (honest, not hidden)

1. Live sign-in / sign-up / MFA end-to-end: NOT done. Needs a
   server auth route (future layer) plus providers enabled live
   (AUTH-SETUP-GUIDE.md) plus migration 05 applied live. Until
   then, sign-in, MFA enroll/verify/unenroll, account deletion,
   and own-profile editing show not-live states and change
   nothing server-side.
2. Live cross-user proof: still pending two real Auth users.
3. Live DOM check (done, headless Chromium via CDP, inline
   build of the shipped files): at 390px, scrollWidth = 390 on
   Feed, Explore, Welcome, and Profile (no horizontal overflow);
   at 1440px, scrollWidth = 1425 < 1440; Explore ranks read from
   the live DOM as 1,2,3,4,5,6; Feed renders 7 sample cards;
   Profile tabs read Opinions|Replies|Reposts|Likes|Bookmarks;
   MFA screen shows its not-connected state. One stale-read
   trap was caught during this check: hash-only navigation to
   the same file URL does not reload the JS, so the first
   re-check showed the old 5-rank/6-card sample — re-run with
   a cache-busting fresh document gave the correct 6-rank/
   7-card result. A human visual screenshot pass (colours,
   meter look, mobile feel) is still owed before launch, per
   the user's QA rule — scrollWidth proves no overflow, not
   that it looks good.
4. Rate limits (Layer 11), notification/daily-question creation
   (stubbed 403 server-only in Layer 5), and the direct-PostgREST
   anonymous-masking gap from Layer 5 all still stand.
5. Voice-score sort paging may repeat a row mid-page (Layer 5
   known limitation); the frontend de-duplicates by id only
   where it renders lists from a single page — multi-page
   de-duplication is a frontend follow-up when pagination UI
   (Load more) is added; Layer 6 lists are single-page.
6. Compose poll attachment is PARTIAL in live mode: options are
   collected and validated client-side (2–6, each ≤80 chars) and
   shown in the preview card, but the live POST currently sends
   only body/topic/is_anonymous — it does not yet make the
   second call to POST /api/opinions/:id/polls with the created
   opinion's id. Poll voting itself (on existing polls) is
   wired. The two-step live poll creation is a follow-up fix,
   not a silent omission.
