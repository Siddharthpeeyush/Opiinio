# Decision 0018 — Polish pass: favicon + route-aware preview banner

## Context

The 2026-10-29 human visual QA pass (53 screenshots) found zero FAILs
but four non-blocking notes: (1) no favicon declared (browsers 404
`/favicon.ico` — the one console error on load); (2) the preview banner
copy "Sample opinions below are illustrative only" also showed on
screens with no opinions below (Sign in, Settings, Compose); (3)
absolute asset paths break `file://` QA (QA used a `/tmp` copy);
(4) `index.html`/`app.js` are served from the domain root on Netlify,
so (3) is fine in production and is NOT changed.

## Decision

- Added an inline SVG data-URI favicon to `public/index.html`: a cream
  (`--paper` `#faf3e3`) rounded square with an ink border and a serif
  "Oi" — matches the editorial look, zero dependencies, works offline
  and under `file://`. No separate favicon file, no new route.
- Made the preview-mode banner route-aware in `public/app.js`
  (`renderModeBanner`): screens that render sample opinions (feed,
  explore, debates, notifications, profile, post, welcome) keep the
  "Sample opinions below are illustrative only" line; sign-in,
  onboarding, compose, and settings get the shorter preview line
  without it.
- Bug found and fixed during this pass (the route-aware copy exposed
  it): `renderModeBanner()` was only called on boot, never on
  hash-change navigation, so the banner went stale after in-app
  navigation. `route()` now calls `renderModeBanner()` right after
  setting `state.route`. Before this change the staleness was
  invisible because the copy was identical on every screen.

## Alternatives considered

- A separate `/favicon.ico` file: rejected — one more static asset to
  serve and cache; the data URI is 337 chars and needs no route.
- Changing absolute asset paths to relative: rejected for now —
  Netlify serves from the domain root where they are correct; the
  `/tmp`-copy QA workaround is documented in `~/AGENTS.md`.

## Consequences

- No test changes needed: no test asserts the banner copy or favicon.
- Verified live in headless Chromium (CDP, fresh document loads):
  feed/explore show the sample line, settings/compose/sign-in do not,
  and in-app hash navigation (feed → settings, no reload) updates the
  banner correctly. Favicon link present in the DOM.
- Tests 196/196, lint clean, typecheck clean, secret scanner clean.

## Gaps

- Local only, NOT pushed. Pushing follows the standing pattern: on
  the user's "push" instruction, with read-back verification.
