# 0022 — React frontend rebuild, dark neon + light themes

Date: 2026-10-30. Status: decided by the user, implemented, pushed.

## Context

The user sent a dark neon UI mockup ("look this UI looks great") and, after the
assistant flagged it as a full re-theme, ordered: "Yes, re-theme the app to
this dark look." He then added "I think react will be best for this" and, when
the assistant framed it as a fast path, corrected: "this product is not a
demo, this is a real project and I want real results."

## Decision

- Full frontend rebuild in **React 19 + Vite + TypeScript**, dark neon theme
  built in from the start. The vanilla `public/app.js` / `styles.css` are
  gone; `vite build` emits into `public/` (hashed `assets/index-*.{js,css}`).
- The **backend/API is untouched** by the rebuild — same routes, same
  contract, same privacy rule.
- Dark is the default theme. On 2026-10-30 the user sent a **light theme**
  mockup of the same layout and ordered "Add this light theme also" with
  "logo should be also the same". Both themes ship with a sun/moon toggle
  in the Topbar; the preference persists in `localStorage` (`opiinio.theme`).
  Session tokens stay in `sessionStorage` only — localStorage never holds
  auth material (guarded by tests).
- The logo is the mockup's three-ribbon swirl (fuchsia/violet/blue) as an
  inline SVG component — no image asset.
- The mockups' "Messages" nav item is deliberately NOT built (no DM
  backend exists). Information architecture is unchanged.

## Consequences

- `src/app.ts` route table: the dead `/app.js` and `/styles.css` routes are
  replaced with a traversal-safe `/assets/*` static route.
- Frontend tests were rewritten from `public/app.js` assertions to
  `frontend/src` source assertions (same intents: privacy guards, screens,
  served pages). The safeSvg QR tests became "no raw-HTML injection sinks"
  tests — the React app has no QR display and no `dangerouslySetInnerHTML`.
- `public/` (build output) is now in `.prettierignore`.

## Follow-up bugs found by the live QA matrix (same push)

The two-QA-user live matrix (2026-10-30 ~02:00 IST) found real server bugs
the mock-store tests could not see:

1. **Every DELETE 500ed live** (unlike, unvote, unfollow, unbookmark,
   delete opinion, vote change): `RestStore.call()` ran `response.json()`
   on PostgREST's empty 204 body → `SyntaxError` → 500. Fixed: return
   `null` on 204 without parsing.
2. **GET /bookmarks (and /muted-topics, /muted-words, /blocks) 500ed
   live**: `RestStore.list()` always ordered/paged by `(created_at, id)`,
   but composite-key tables have no `id` column → PostgREST 400 → 500.
   Fixed: derive `hasId` from `COLUMNS`; page composite tables on
   `created_at` alone (documented repeat risk on identical timestamps).
3. **Frontend/backend key mismatches** (would have broken the UI for real
   users): the React client sent camelCase (`optionId`, `opinionId`,
   `followingId`, `displayName`, `read`, `isAnonymous`) where the API
   requires snake_case (`option_id`, `opinion_id`, `following_id`,
   `display_name`, `is_read`, `is_anonymous`). Fixed in `frontend/src/api.ts`;
   the ComposeScreen anonymous toggle is now wired into the post payload.

Regression tests added for (1) and (2) in `tests/api-privacy.test.ts`.
