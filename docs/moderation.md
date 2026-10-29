# Opiinio moderation

Status: final layer (0017). What exists today vs what is
documented future. No moderation tooling is built in V1 beyond
the report flow — that is stated here, not hidden.

## What exists today (in code)

- **Report flow:** any signed-in user can file a report
  against an opinion or a reply (`POST /api/reports`, reason
  ≤ 280 chars, exactly one target). Reports are stored in the
  `reports` table; each user sees only their OWN reports
  (`GET /api/reports` is own-only — there is deliberately no
  "all reports" endpoint, per the privacy rule).
- **Self-defence tools (all undoable):** block a user
  (removes the follow both ways, hides their posts), mute a
  topic, mute a word, and the Respect Filter in Settings.
- **Rate limits** (Layer 11) blunt spam bursts: 60 writes /
  5 min per user, strict 5 / 15 min on auth routes.
- **Audit trail** (final layer): blocks, reports, mutes, MFA
  changes, and password changes are recorded as id-only
  audit lines in the structured log stream.

## The moderation queue (documented future, NOT built)

Reports currently land in a table nobody triages. Before
anonymous mode can scale, a human review loop must exist:

- **Who reviews:** the owner (Siddharth) initially — one
  person, so the queue must stay small by design.
- **Starting SLAs (tune after real volume):** safety issues
  (threats, illegal content) within 24h; spam/harassment
  within 48h; everything else within 7 days.
- **Actions available:** dismiss report, remove the content,
  warn, suspend, ban. Removal/suspension tooling does not
  exist yet — today the only lever is direct database
  access, which is honest but not a process.
- **What the queue needs when built:** a reviewer view
  (reported content + reporter history + author history),
  action buttons writing to the existing tables, and every
  action audited. It must NOT become a voter-list or
  enumeration oracle — the privacy rule binds the admin
  surface too.

## Anonymous-mode abuse controls — UNDECIDED (owner's call)

From `docs/system-design.md` open question 5, still awaiting
the user's decision:

- **Option A (recommended in system design):** limit
  Anonymous mode to one anonymous post per user per day at
  launch; add the review queue as volume grows.
- **Option B:** build the review queue FIRST and hold
  anonymous posting until a human can triage.

Do NOT implement either without the user's explicit choice.
Anonymous posting with neither control is the one outcome
this doc forbids: unthrottled, unreviewed anonymity plus the
direct-PostgREST masking limitation (decision 0011) is the
highest-abuse-risk combination in the product.

## Escalation

- Illegal content (CSAM, credible threats, etc.): remove
  first, preserve the audit trail, report to authorities —
  no SLA applies, act immediately.
- Everything else follows the SLAs above once the queue
  exists. Until then, the owner triages from the database
  directly and records actions in the decision log.
