# Opiinio — System Design

Status: Part 0 / Layer 1 plan. No feature code depends on this document
yet; the next layer (architecture + scaffold) is deliberately kept
separate so this design can be reviewed before it is built.

## 1. Problem statement

People want a place to state an opinion in words, see where others stand,
and argue the point — without the noise of photos, videos, and
algorithmic feeds built for media. Existing social apps optimise for
media and followers; Opiinio optimises for the opinion itself: a short
text, a stance, a reasoned reply, and a visible split of agreement.

Opiinio answers: "What do people actually think about this, and why?"
in 280 characters per opinion, with the split (Agree / Neutral /
Disagree) visible at a glance.

## 2. User roles

| Role                                    | Can do                                                                                                                                                                              | Cannot do                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Visitor (logged out)                    | Read public opinions, explore ranked topics, view debates and public profiles                                                                                                       | Post, reply, vote, repost, bookmark, follow, poll-vote, report                        |
| Registered user                         | Everything a visitor can, plus post, reply, vote, repost (plain + quote), bookmark, follow (public instant), create text-only polls, use Anonymous mode per post, mute/report/block | See another user's private data, act as another user, moderate others                 |
| Moderator / admin (later layer, not V1) | Review reported content, act on abuse (recorded as a future layer, not built now)                                                                                                   | — (role does not exist in V1; reports in V1 only hide content for the reporting user) |

There is no organisation role, no team role, and no paid-tier role in V1.
Roles are personal accounts only.

## 3. Core user flows

1. **Sign up / sign in** — Google or email (Supabase Auth). Email
   verification, password reset with expiry, session expiry. No SMS OTP.
2. **Write an opinion** — 280 characters, topic picker, optional
   text-only poll, optional per-post Anonymous mode. "Everyone can
   reply" is the default reply setting at launch.
3. **Read the feed** — tabs: For You / Trending / Debates / Following.
   Sort: Latest / Discussed / Most liked (design target; exact sort
   implementation is a later layer).
4. **Take a stance** — Agree / Neutral / Disagree on an opinion.
   The Opinion Meter shows the live split (balance-scale / tug-of-war
   presentation in the editorial look).
5. **Reply and debate** — replies carry a For / Against side, filterable
   by side; Debate Mode splits a thread into For vs Against columns.
   Replies are ranked by Voice Score, with a Best Argument badge on the
   top reply, re-sortable by Newest.
6. **Repost** — plain Repost, or Quote Repost (your take above the
   original). Both appear under Profile → Reposts.
7. **Bookmark / Read Later** — save an opinion; it appears under
   Profile → Bookmarks and in a Read Later list.
8. **Daily Question** — a card at the top of the feed; answering it
   badges the post as a Daily answer.
9. **Explore** — ranked Trending Topics (1–6 in the design), topic
   search, People to Discover ranked by Voice Score.
10. **Debates** — list of debates with Join Debate, which opens that
    thread in Debate Mode.
11. **Notifications** — All / Mentions / Replies / Updates (screen
    exists in the design; real push delivery is a later layer).
12. **Profile** — Following / Followers counts, tabs Opinions / Replies /
    Reposts / Likes / Bookmarks, pinned opinion. Avatars are initials
    only at launch.
13. **Respect Filter** — mute words, and per-post Report, Mute topic,
    Block author. All three hide posts for that user and are undoable.
    Blocking removes the follow both ways (design rule from the
    followers discussion; enforcement is a later layer).
14. **Share** — share-as-text (copy to clipboard), not a media share.
15. **Language** — Hindi ↔ English toggle. In the prototype this
    switches sample content only; live translation of user posts is
    NOT in scope (no paid API).

## 4. Functional requirements (V1 design targets)

- FR1 Post an opinion: ≤ 280 characters, topic, optional poll,
  optional Anonymous mode.
- FR2 Reply to an opinion with a For / Against side.
- FR3 Vote Agree / Neutral / Disagree; one stance per user per opinion
  (enforcement in a later layer; the design intent is one vote, and
  the poll rule below is the same pattern).
- FR4 Plain Repost and Quote Repost; both listed under Profile Reposts.
- FR5 Like, Bookmark/Read Later, share-as-text.
- FR6 Public instant follow / unfollow; no self-follow; blocking
  removes the follow both ways and hides posts.
- FR7 Text-only poll attached to a post, one-vote lock, live
  percentages.
- FR8 Voice Score on replies; Best Argument default sort, Newest sort
  available.
- FR9 Daily Question card; answers badged as Daily answers.
- FR10 Explore: ranked topics, topic search, People ranked by Voice
  Score (ranking by argument quality, not follower count).
- FR11 Debates list with Join Debate → Debate Mode thread view.
- FR12 Notifications list, filtered All / Mentions / Replies / Updates.
- FR13 Profile with the five tabs above, Following/Followers counts,
  pinned opinion.
- FR14 Respect Filter: mute words, Report, Mute topic, Block author —
  all hide posts, all undoable.
- FR15 Hindi ↔ English toggle for UI and sample content (not live
  translation).

## 5. Non-functional requirements

- Performance: text-only payloads are tiny; target p95 < 300 ms for
  the core feed read at launch scale (to be load-tested in a later
  layer, not claimed now).
- Mobile-first: works at 375 px width and on desktop.
- Accessibility: WCAG 2.1 AA (labels, keyboard navigation, visible
  focus, contrast on cream paper, heading order, ARIA only where
  needed, automated check in tests in a later layer).
- Security: proven auth only; server is the source of truth for
  permissions; frontend hiding a button is not security; no secrets
  in client code or logs.
- Privacy: no media upload means no media storage, no media
  moderation queue, and no EXIF/location surface in V1. Anonymous
  posts show as "Anonymous" even to followers.
- Cost: ₹0 at launch (Netlify free + Supabase free). No paid API.
- Reliability: health endpoint, structured logs, error tracking, and
  runbooks are later layers; the scaffold health check in this step
  covers the app process only.

## 6. Tenancy model (explicit)

- There are no organisations. Tenancy = one personal account.
- Every user-owned row carries `user_id` (UUID, NOT NULL, foreign key
  to the auth user). Every read, write, update, and delete in a later
  layer must be scoped by `user_id` or by an explicit public-visibility
  rule for public opinions.
- Public opinions are readable by visitors, but only their author (or
  a moderator in a later layer) may edit or delete them.
- Cross-user test (required in a later layer): User A must get 404
  (not 403, not the data) when requesting User B's private resource by
  changing an id in a URL; unauthenticated requests get 401,
  unauthorised requests get 403.
- Anonymous posts: the author id is stored server-side for moderation
  and for the author's own list, but is never rendered to other users.
- Follows are one small record per follow (follower_id, following_id,
  created_at; unique on the pair) — never a list inside a profile row.
  Follower/following counts are stored and updated in the same
  transaction as the follow, not counted by scanning on every profile
  open (keeps the free tier viable).

## 7. Out of scope (V1 — recorded, not forgotten)

- Media upload of any kind: photos, videos, audio, files, profile
  photos, cover photos. (Profile photos are a possible later layer
  only after a storage + moderation + cost decision by the user.)
- Follow-request approval (the user chose public instant follow).
- Team invites, roles, organisations, and team management.
- Direct messages.
- Paid premium, ads, and sponsored debates as implemented features
  (monetization is a plan, not V1 code).
- Live translation, paid AI features, and any paid API.
- Native mobile apps (Play Store / iOS). V1 is a web app (Netlify).
- Real push notifications (the Notifications screen is a design
  target; delivery is a later layer).
- "Changed My Mind" edit history and following topics instead of
  people (pitched early, explicitly not in the prototype, not in V1
  unless the user re-adds them).
- Custom domain purchase (availability not checked, nothing bought;
  needs a separate approval plus the exact checkout price).

## 8. Skeptical review (what could break this design)

Ranked by severity, simplest fix first:

1. **HIGH — Follower-count gaming / ranking abuse.** If Explore or
   People ranked by follower count, early accounts would dominate.
   Mitigation (in design): rank by Voice Score / Best Argument, not
   follower count; rate-limit rapid follows (later layer).
2. **HIGH — Anonymous abuse.** Anonymous mode could be used for
   harassment. Mitigation: author id still stored server-side;
   Report / Mute / Block hide content for the reporter; moderation
   queue is a later layer and must be built before Anonymous scales.
3. **MEDIUM — Vote/poll stuffing.** One stance / one poll vote per
   user must be enforced in the database (unique constraint), not
   only in UI, or counts are meaningless.
4. **MEDIUM — Free-tier limits.** Supabase free pauses after inactivity
   and caps storage/bandwidth; Netlify free caps bandwidth. Mitigation:
   text-only payloads keep usage tiny; billing alerts; upgrade only
   after revenue covers it.
5. **LOW — Hindi toggle confusion.** A toggle that only switches
   sample content, not user posts, will confuse users if labelled as
   translation. Mitigation: label it honestly in the UI copy in the
   frontend layer.

## 9. Year-1 load estimate (shown math)

Assumptions (to be confirmed by the user; these are planning
assumptions, not promises of traffic):

- Launch month: 1,000 monthly active users (MAU).
- Month 12: 20,000 MAU (steady growth, no viral spike assumed).
- Average active user: 10 sessions/month, 20 feed reads/session,
  5 writes (post/reply/vote/repost) per session.
- Average opinion: 280 characters max → use 200 characters average
  ≈ 200 bytes of text + ~100 bytes of metadata = ~300 bytes/row.
  A reply is the same order of magnitude. Indexes roughly double
  stored size for planning purposes → ~600 bytes per stored row.

Month-12 monthly request math:

- Reads: 20,000 users × 10 sessions × 20 reads = 4,000,000 reads/month.
- Writes: 20,000 × 10 × 5 = 1,000,000 writes/month.
- Total: ~5,000,000 requests/month ≈ 1.9 requests/second average.
- Peak (10× average, evening spike): ~19 requests/second.
  A single modular-monolith instance with connection pooling handles
  this comfortably; the bottleneck that appears first is database
  connections under serverless-style bursts, not CPU — hence
  connection pooling is a named requirement for the backend layer.

Database size, month 12:

- Opinions: assume 2 posts/user/month → 40,000 posts/month.
  Replies/votes are smaller rows but more numerous; use a generous
  500,000 user-generated rows/month total (posts + replies + votes +
  follows + bookmarks).
- 500,000 rows × 600 bytes ≈ 300 MB/month of new data.
- After 12 months of growth (not a flat 500k/month from day one;
  roughly triangular growth, average ~half the month-12 rate):
  ~12 × 150 MB ≈ 1.8 GB in year 1, before any archiving. This exceeds
  the Supabase free database allowance (500 MB) if growth reaches
  month-12 rates and nothing is archived — so either growth is slower,
  old data is archived/aggregated, or a paid tier is needed before
  month 12. This is flagged honestly here, not hidden: the ₹0 launch
  holds at launch scale, not automatically at 20,000 MAU.

File storage size: 0 bytes by design (text-only, no uploads).

Background job volume: notifications digests, Daily Question rotation,
and trending-rank recomputation are the only regular jobs in V1
design. At month-12 scale: Daily Question rotation 1/day, trending
recompute hourly (720/month), notification digests batched per user
per day at most — a few thousand job runs/month, trivial for a
scheduled job inside the monolith or a Supabase scheduled function
(decision deferred to the backend layer).

Bottleneck that appears first: **database connections, then database
size** — in that order. Mitigations: connection pooling, cursor
pagination (never unbounded lists), indexes on every filter/sort
column, and an archiving/aggregation decision before month 12.

## 10. Open questions (user to confirm)

1. Supabase project creation (user's account; placeholders only here).
2. GitHub repo creation (user's account; push after creation + app
   access grant).
3. Custom domain: check Opiinio availability; buy only with separate
   approval + exact price.
4. Is 20,000 MAU by month 12 the right planning target, or should the
   estimate be re-run at 5,000 / 50,000 MAU?
5. Moderation queue timing: build it before Anonymous mode scales, or
   limit Anonymous mode at launch? (Recommendation in the next layer:
   limit Anonymous to one post per user per day at launch, then add
   the queue — to be confirmed.)
