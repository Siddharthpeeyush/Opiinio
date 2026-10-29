# Opiinio cost at scale — 1x / 10x / 100x

Status: planning math, final layer (0017). All numbers are ESTIMATES
from the system-design per-user rates, not measurements. Prices are
as verified October 2026 and WILL drift — re-check before spending.

## Free-tier limits used here (verified 2026-10-29)

**Supabase free** (per project): 500 MB database · 5 GB egress/month ·
50,000 auth MAU · 2 active projects · 60 direct / 200 pooled DB
connections · **NO automatic backups** · project pauses after 1 week
of inactivity.

**Supabase Pro** (estimate, verify at the time): **$25/month** per
project — 8 GB database, 250 GB bandwidth, 7 days of daily backups.
Overage beyond included quotas is metered (e.g. ~$0.09/GB egress).

**Netlify free — READ THIS CAREFULLY:** Netlify moved to
credit-based billing in Sept 2025. **New accounts** get 300
credits/month ≈ **~15 GB of transfer** (20 credits/GB; deploys cost
extra). **Legacy accounts** (opened before 2025-09-04) keep the old
100 GB/month. When credits run out, sites pause until next cycle.
**Check which one applies in the Netlify dashboard before trusting
any number below** — this is the single most likely surprise.

## Per-user-month rates (from docs/system-design.md §9)

- Requests: 10 sessions × (20 reads + 5 writes) = **250 req/user/mo**
- New DB rows: **25 rows/user/mo** (~600 bytes/row with indexes)
- Client↔app bandwidth: ~240 KB/session (app.js + page + API
  payloads) ≈ **2.4 MB/user/mo**
- App↔Supabase egress: API payloads only ≈ **0.5 MB/user/mo**

## The table

|                          | 1x: 1,000 MAU (launch) | 10x: 10,000 MAU                                | 100x: 100,000 MAU |
| ------------------------ | ---------------------- | ---------------------------------------------- | ----------------- |
| Requests/month           | 250,000                | 2,500,000                                      | 25,000,000        |
| Avg req/sec              | 0.1                    | 1.0                                            | 9.6               |
| New DB rows/month        | 25,000 (~15 MB)        | 250,000 (~150 MB)                              | 2.5M (~1.5 GB)    |
| Client↔app bandwidth/mo | ~2.4 GB                | ~24 GB                                         | ~240 GB           |
| Supabase egress/mo       | ~0.5 GB                | ~5 GB                                          | ~50 GB            |
| Auth MAU vs 50k free cap | fine                   | fine                                           | **EXCEEDED**      |
| Supabase free verdict    | ✅ comfortable         | ⚠️ at the edge                                 | ❌ paid required  |
| Netlify free verdict     | ✅ (either model)      | ⚠️ new-acct credits likely exceeded; legacy OK | ❌ paid required  |

Reference: the system-design month-12 target (20,000 MAU) sits at
roughly **2× the 10x column** — i.e. the ₹0 story already needs
re-examination well before month 12 if growth tracks the plan.

## Where ₹0 breaks, in order

1. **Supabase egress (5 GB/mo)** — first wall, hit around
   ~10,000 MAU at these rates. The local load test (0017) shows
   the app itself is not the bottleneck; the metered pipe is.
2. **Supabase database (500 MB)** — second wall. At 10x rates the
   cumulative store crosses 500 MB within a few months with no
   archiving. Mitigations before paying: archive/aggregate old
   rows (votes and notifications age fastest), shrink indexes.
3. **Auth MAU (50,000)** — only matters at 100x.
4. **Netlify credits/bandwidth** — parallel wall for client
   traffic; the credit model makes this tighter than the old
   100 GB suggests. Verify the account type early.
5. **DB connections (60 direct / 200 pooled)** — the
   system-design bottleneck; Supabase's pooler covers launch
   scale, but serverless-style bursts are the thing to watch
   (see docs/monitoring.md).

## First paid step (when, not if)

**Supabase Pro at ~$25/month** (estimate — verify current pricing
before buying): 8 GB database + 250 GB bandwidth covers everything
up to roughly the 100x column's database needs and most of its
bandwidth. Do NOT upgrade pre-emptively: set the billing alerts
from docs/hosting.md, and upgrade when a meter — not a forecast —
says so. Netlify's paid step is separate and follows its own
credit/bandwidth meter.

## Most expensive component at each level

- **1x:** nothing — all meters under 50% of free quotas.
- **10x:** Supabase egress, then database size. Both are
  "soft" walls: archiving + payload discipline (cursor pages
  are already capped at 50, responses are text-only) push the
  wall further out before $25/mo is needed.
- **100x:** Supabase as a whole (DB size growth 1.5 GB/mo,
  egress 50 GB/mo, MAU cap) — at this point the $25/mo Pro
  tier is simply the cost of doing business, and the
  conversation becomes Pro vs usage-metered overages.

## What this doc does NOT promise

- Traffic. The MAU figures are planning rungs, not forecasts.
- Prices. Re-check Supabase and Netlify pricing the week you
  pay anything.
- That the per-user rates survive contact with real users —
  the first re-run of this math happens after 30 days of real
  traffic, using the structured logs (request counts are
  already logged; sizes are not — that instrumentation is a
  follow-up if egress becomes the binding constraint).
