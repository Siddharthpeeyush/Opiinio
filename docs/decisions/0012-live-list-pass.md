# 0012 — Live-list pass: feed, notifications, and own-profile fetch live data

Status: Accepted for V1 (live-list pass only). No CI/CD, no
rate-limit store, no monitoring, no live Supabase call, no
GitHub push in this step.

## Context

The server auth route layer (decision 0011) left a precise
leftover, recorded rather than hidden: a signed-in user could
post, vote, and manage MFA through real routes, but Feed,
Notifications, and own-profile (`#/profile/me`) still rendered
Layer 6 sample data, and `#/profile/me` still showed a sign-in
prompt even with a real session. This pass closes exactly that
gap. It does not add new API routes, does not change the
server, and does not invent any route the API deliberately
lacks.

## Decision

- **Live loaders in `public/app.js`, `/api/*` only.** New
  loaders — `loadLiveFeed`, `loadLiveNotifications`,
  `loadLiveProfile`, `loadLivePost`, `loadLiveDaily`,
  `loadMoreLive` — call the Layer 5 endpoints through the
  existing same-origin `api()` helper (Bearer token from
  sessionStorage). No new `fetch` call exists outside that
  helper, no Supabase/PostgREST/GoTrue host is built in the
  frontend, and no direct-table or "view raw" path is offered.
  That keeps the Layer 5 anonymous-masking guarantee intact:
  the app API remains the only read path.
- **Router loads before rendering.** `route()` is now async.
  For feed, explore, debates, notifications, profile, and post
  routes in live mode it renders a loading state, awaits the
  loader, then renders. Public feed reads work without a
  session where the API allows them; private lists require a
  session and show the auth-required state when signed out,
  never another user's private data.
- **Error contract, per the task.**
  - 401 on a private call: the stale session is cleared and
    the screen shows sign-in-required, never sample data
    disguised as live.
  - 401 on a public call: the session is cleared and the call
    is retried once without a token (a presented-but-rejected
    token must not silently downgrade, but a public list
    should not fail for a dead token either).
  - 503 / network: the mode flips to labelled preview and the
    preview banner shows; feed, explore, debates, and
    notifications fall back to the labelled sample lists.
    A specific user's profile does NOT fall back to a sample
    profile on 503 — that would present a wrong person as
    the requested user — it shows an error state instead,
    with the preview banner on. That deviation from the
    generic preview rule is deliberate and is recorded here.
- **Own-profile (`#/profile/me`).** The signed-in user's id
  is resolved from the session (`/auth/session` when the
  stored session has no id — e.g. the Google hash flow) and
  the profile, opinions, reposts, and bookmarks tabs are
  fetched from the API. Counts and the pinned post come from
  the server profile (`followerCount`, `followingCount`,
  `pinnedOpinionId`); the old hard-coded "320 Following ·
  12.4K Followers" and "first opinion as pinned" behaviours
  are gone in live mode. No follow button is shown on your
  own profile. Other users' profiles use their public API
  data only.
- **Notifications.** Fetched from `GET /notifications`,
  unread count from the server items, mark-read through
  `PATCH /notifications/:id` (the local list is updated in
  both the sample and live stores so the button state is
  consistent). Actors stay masked as "Anonymous" / "AN" via
  the server serializers; the frontend never unmasks.
- **Cursor pagination + de-duplication.** Lists use the
  Layer 5 cursor (`nextCursor`, capped at 50, default 20).
  A "Load more" button appears when a cursor exists, for
  feed, notifications, and profile tab lists alike, and
  appended pages pass through `dedupeById`, so the known
  voice-score paging repeat (Layer 5 limitation) never
  shows twice. After a load-more, the router reuses the
  cache (`skipLiveRefetch`, consumed once); any other
  navigation refetches, so stance/like/bookmark actions
  show fresh server counts instead of stale cached ones.
- **Explore and topic pages.** Explore ranks are computed
  from the live first page (same like+repost signal as
  before, now live data, with the note text changed to say
  so). Search in live mode calls
  `/opinions?search=…&limit=20`; the topic page calls
  `/opinions?topic=…&limit=20` with load-more. People to
  Discover stays absent — no profile-list route exists,
  pending its privacy review, and this pass invents none.
- **Post detail, a necessary extension.** Live feed cards
  link to `#/post/:id`, so a live feed without a live post
  page would be broken. `loadLivePost` fetches the opinion,
  its replies (best/newest per the current sort), and its
  poll (404 tolerated = no poll), and renders them with the
  existing layout. Feed action handlers (stance, like,
  bookmark, repost, mute-topic, block, poll-vote) now look
  up opinions in the live lists as well as the samples;
  before this pass they silently did nothing for live ids.
- **Preview behaviour preserved.** When the API is
  unconfigured (503 at boot) the app stays in labelled
  preview mode exactly as in Layer 6: banner, Sample badges,
  preview-local actions. Sample data is never copied into a
  live field, and a live success never renders a sample card.

## Alternatives considered

- Cache-first feed (reuse `detectMode`'s first page and
  never refetch on navigation): rejected — it would show
  stale counts after the user's own stance/like actions.
  Refetch-on-navigation (except the single load-more
  render) costs one request per navigation at launch scale
  and keeps counts honest.
- Client-side follows list by fetching every profile:
  rejected — there is no follows-list endpoint, and
  guessing one from opinions would be fabrication.
- Faking replies/likes tabs from opinion scans: rejected
  — scanning all opinions to reconstruct a user's replies
  or likes would be a scrape, not a list, and would leak
  other users' activity in aggregate.

## Consequences and honest limits — what this pass cannot do alone

1. **Following tab has no live data.** The API has follow
   and unfollow but no list of the people you follow, so
   the Following tab in live mode shows an honest empty
   state saying so (auth-required when signed out). This
   is a missing endpoint, not a frontend bug, and it needs
   its own privacy-reviewed route before it can be filled.
2. **Profile Replies tab has no live data.** There is no
   replies-by-user route (replies are listed per opinion
   only), so the tab shows an honest no-route state in
   live mode. Replies remain visible on each opinion's page.
3. **Profile Likes tab has no live data.** There is no
   likes-by-user route (like/unlike only), so the tab shows
   an honest no-route state in live mode, for own and other
   profiles alike. Bookmarks, by contrast, are fully live
   for the owner (`/bookmarks` → opinion fetch per item,
   failures skipped, de-duplicated).
4. **Debates tab costs one replies request per opinion**
   (up to 20, in parallel, failures tolerated) because the
   opinion list carries no reply sides. Acceptable at
   launch scale; flagged as the first optimisation if the
   list grows (a server-side "has both sides" flag would
   replace it).
5. **Daily card uses the first daily question returned**
   by `GET /daily-questions`. The API has no "today's
   question" endpoint, so the live daily card may show an
   older question until one exists. It never shows the
   sample daily question as live.
6. **Reply-like on a live post still shows the preview
   toast.** The global reply-like handler predates this
   pass and toasts "preview only" regardless of mode; it
   was left untouched as out of scope for a list pass, and
   it is recorded here rather than hidden. Fixing it is a
   one-branch follow-up (call the live like endpoint when
   not in preview).
7. **Live behaviour is mocked, not proven.** All live
   behaviour here is proven with static file tests and a
   no-env server run (see below). No live Supabase data
   was fetched: no key, providers not enabled live,
   migration 05 not applied live. The live cross-user
   proof still needs two real Auth users.
8. **Still standing from earlier layers:** rate limits
   (hooks only, Layer 11), notification/daily-question
   creation (stubbed 403 server-only), account deletion
   (gated but SERVER_ONLY, not completed), the
   direct-PostgREST anonymous-masking gap (this frontend
   never exposes a direct-table path, which is the
   mitigation within its control), and a human visual
   screenshot pass plus a screen-reader/keyboard audit
   before launch.

## Verification (actual, this pass)

- `npm run typecheck` — exit 0
- `npm run lint` — exit 0
- `npm run format:check` — "All matched files use Prettier
  code style!"
- `npm test` — 135 tests, 135 pass, 0 fail (was 125; +10
  new in `tests/live-list.test.ts`)
- Live server proof (fresh port 3041, server stopped
  afterwards, port verified closed): `GET /` → 200,
  `GET /app.js` → 200 (contains `loadLiveFeed`),
  `GET /api/health` → 200 app-scope only (database/auth
  `not_configured`, never `ok`), `GET /api/docs` → 404,
  `GET /api/opinions` → 503 (no env — the preview trigger).
- One test failure during this pass was a test bug, not a
  code bug: the new profile test asserted the whole
  `screenProfile` function contains no sample counts, but
  the preview branch legitimately still renders them. The
  test was narrowed to the live branch only (a stronger,
  not weaker, check — it proves the live branch, not the
  whole function). Suite re-ran green after the fix.
- One tooling trap during this pass: a `pkill` pattern
  matching the server command line also matched the
  shell's own command line and terminated the exec
  session. The follow-up check confirmed no server process
  remained and the port was closed; the server proof above
  was already complete before that happened.
