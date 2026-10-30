# 0025 — Rail and hero no longer show sample data as live data

Date: 2026-10-30
Status: Accepted, pushed (e427928c), deployed via Netlify auto-deploy.

## Problem

The user sent phone screenshots of the signed-in app showing the
"Today's Question" hero ("Should AI be regulated more strictly by
governments?", "12.4K opinions") and the right rail (Opinion Meter
58/14/28 with "7.2K / 1.7K / 3.5K", Trending Topics with "12.4K
opinions", Suggested Debates) and said "not working area".

He was right. In `frontend/src/App.tsx`:

- `FeedScreen` rendered `<Hero>` hardcoded to `PREVIEW_QUESTION` +
  `opinionCount="12.4K"` — unconditionally.
- The right rail rendered `<OpinionMeter>` (hardcoded `PREVIEW_METER`
  - literal `"7.2K"`/`"1.7K"`/`"3.5K"` strings), `<TrendingTopics
topics={TRENDING}>`, and `<SuggestedDebates debates={DEBATES}>` —
    unconditionally, with no reference to `mode` at all.

So a signed-in user in live mode saw sample numbers presented as real
engagement. This violated the standing rule in `preview.ts`: sample
data is "shown ONLY under the preview banner, never presented as real
posts, users, or counts."

## Fix

- `FeedScreen` now takes `ctx` and, in live mode, fetches the real
  daily question via the existing `api.getDailyQuestion()`. The hero
  renders only when a question exists (nothing is seeded yet, so it
  correctly hides); "Join Debate" → `#/compose`, "View All Opinions" →
  `#/explore`. Preview mode keeps the labelled sample hero.
- The rail now branches on `liveMode`:
  - Live: only `<TrendingTopics>` derived from the actually loaded
    opinions (`liveTrending` memo, counts by topic). Hidden entirely
    when there are no opinions. The meter and suggested debates have
    no live data source yet, so they stay hidden instead of showing
    samples.
  - Preview: unchanged sample rail under the ModeBanner label.

## Verification

- `tsc --noEmit` clean, `npm run lint` clean, `npm test` 219/219
  (new regression test in `tests/frontend.test.ts`: "rail and hero
  never show sample data as live data" — asserts the live rail branch
  contains no `PREVIEW_METER`/`PREVIEW_QUESTION`/`TRENDING`/
  `SuggestedDebates` and that `FeedScreen` calls `getDailyQuestion()`).
- Built (`index-CnZQleFD.js`), pushed as e427928c, read-back verified
  on main. Netlify auto-deploys; the user needs one refresh to pick up
  the new bundle.

## Follow-ups

- Opinion Meter in live mode needs a real aggregate source (per-question
  stance totals endpoint) — not built; hidden for now.
- Suggested Debates in live mode needs a real source — not built;
  hidden for now.
- When the first daily question is seeded, the hero will appear with a
  real count of answers.
