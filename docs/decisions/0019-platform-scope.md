# Decision 0019 — Platform scope: web + mobile app + web admin panel

## Context

On 2026-10-29 the user expanded Opiinio's scope: the platform must be
**mobile-app based as well as web based**, plus a **web-based admin
panel** where he handles all operations, sees insights, and posts
sponsored ads himself. He asked the assistant to add anything he
missed. This record captures the direction and the gap analysis;
**sequencing (before vs after web launch) is still the user's open
decision.**

## Direction stated (user)

1. Web app — built, in pre-launch (Layers 0–16 + polish, 196/196 tests).
2. Mobile app — native-app presence alongside web. (Earlier status:
   "native app / Play Store listing (never approved; build is web)".)
3. Web admin panel — operations, insights/analytics, and self-serve
   sponsored-ads posting by the owner.

## Sequencing — DECIDED 2026-10-29 (user tapped "launch web first,

## then admin panel, then mobile")

1. **Web launch first** — finish the pre-launch checklist (his Google
   OAuth step, Netlify deploy, live proofs).
2. **Admin panel second** — built after web is live, before sponsors
   arrive: user management, moderation queue, insights dashboard,
   sponsored-content manager.
3. **Mobile third** — PWA first (₹0, reuses web build), native
   (Play Store $25 one-time; Apple $99/yr after revenue) last.

## Assistant's gap additions (user asked for these)

- **Analytics instrumentation** — the admin insights dashboard needs
  event data (signups, DAU/WAU, opinions, votes, debate joins,
  retention). No analytics exists today (Layer 16 deferred it).
- **Admin roles in the DB** — no roles exist in the schema. Admin
  panel needs a role (e.g. `profiles.is_admin` or a roles table) with
  server-enforced checks; per the standing privacy rule, admin sees
  aggregates + reported content, NEVER private tables
  (bookmarks, mutes, blocks, notifications) or raw PII.
- **Sponsored-content data model** — tables for sponsored daily
  questions and in-feed sponsored slots: creative copy, schedule
  window, label, status (draft/scheduled/live/ended), impressions.
  Labelled "Sponsored" in every render path, never disguised.
- **Push notifications** — the biggest mobile engagement lever.
  Web push (VAPID) is free; native push needs the native app.
  Not in any layer today.
- **Anonymous-mode abuse controls** — still UNDECIDED (pre-launch
  checklist section B). Needed before scale, whichever client.
- **Age gate 13+ vs 18+** — still UNDECIDED; app stores require a
  declared rating, so this blocks any store listing.
- **Privacy Policy update for ads/trackers** — the standing
  no-third-party-trackers rule conflicts with AdSense/Monetag.
  Launch keeps the rule; ads need a rule amendment + disclosure.
- **Deep links** — shared opinion links should open in the app
  (web URL → app), needed for the Share feature to pay off.
- **Play Store listing decision** — $25 one-time; Apple is $99/year
  (breaks the ₹0 rule until revenue).

## Mobile path recommendation (assistant, not yet decided)

- **PWA first**: the shipped web app + manifest + service worker =
  installable on Android/iOS, ₹0, no store review, reuses 100% of
  the built frontend. Offline scope stays as the user decided
  (full offline mode excluded).
- **Native later** (React Native or Flutter = second codebase):
  only when revenue justifies it — Play Store $25 one-time is
  fine, Apple $99/yr waits for revenue.

## Admin panel shape (assistant proposal, not yet decided)

- Separate web surface (same repo, `/admin/*`, admin-role gated),
  never mixed into the user app: user management (view/suspend,
  no private-data browsing), moderation queue (reports triage with
  the SLAs from docs/moderation.md), insights dashboard (growth,
  engagement, content health), sponsored-content manager
  (create/schedule/label sponsored questions + in-feed slots).
- Every admin action goes through `can()` + an audit entry
  (src/lib/audit.ts already exists for this).

## Consequences

- None of this changes the web pre-launch checklist; it is
  additive scope after (or alongside) launch, per the sequencing
  decision.
- Cost note: PWA + admin panel keep ₹0. Native iOS breaks ₹0
  ($99/yr Apple fee) — sequenced after revenue by default.
- This record does NOT authorize building any of it; it captures
  the direction so the next "continue" has a defined target.
