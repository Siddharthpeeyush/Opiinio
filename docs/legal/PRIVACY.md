# Opiinio — Privacy Policy (DRAFT)

Status: draft, final layer (0017). Written against the ACTUAL
schema and code in this repo — not a template. **Not yet
reviewed by a lawyer. Do not publish as-is without legal
review.**

## 1. What we store

- **Account:** the identifier from your sign-in provider
  (Supabase Auth), your chosen handle and display name, bio,
  and counts (followers, following). No passwords are stored
  by us — authentication is handled by Supabase.
- **Your activity:** opinions, replies, poll votes, stances,
  likes, reposts, follows, bookmarks, muted topics/words,
  blocks, reports you file, and notifications. All text is
  capped at 280 characters by design.
- **Security records:** sign-in attempts are rate-limited;
  sensitive actions (MFA changes, password changes, blocks,
  reports) are recorded in an append-only audit trail that
  contains only ids — never message content, emails, or
  secrets.

## 2. What we deliberately do NOT store or do

- No photos, videos, or file uploads exist in the product.
- No location tracking. No advertising trackers. No
  third-party analytics SDKs.
- No cookies: sessions live in your browser's session
  storage only and vanish when the tab closes.
- We do not sell personal data. Ever. (Future revenue is
  ads and sponsored debates, per the product plan — never
  data sales.)

## 3. Anonymous mode

An anonymous post is shown to all other users as "Anonymous"
— followers included. Internally we retain the authorship
link (needed for abuse handling, your data export, and
account security). It is never exposed through the app's API;
note the honest limitation in our docs: anyone holding the
database's public read key could query raw tables directly,
which is why anonymous posting is subject to abuse controls
(see docs/moderation.md).

## 4. Your rights

- **Export:** download everything we store about you at any
  time from your account (in-app: Settings → Export, backed
  by `GET /api/account/export`).
- **Delete your content:** you can delete your opinions and
  replies individually at any time.
- **Delete your account:** HONEST STATUS — full
  account deletion is not yet available in the app. It is a
  recorded, scheduled piece of work (the deletion endpoint
  currently refuses by design until a secure admin path
  exists). Until it ships, deleting your content piece by
  piece removes everything other users can see.

## 5. Security

- Row-level security on every table, auth-first on every
  route, optional TOTP two-factor authentication.
- Server logs are structured and redacted by construction:
  they carry request ids, routes, and status codes — never
  tokens, passwords, emails, or message content.

## 6. Data location and retention

- Database: Supabase, EU region (eu-west-1, Ireland).
- Operational logs: Supabase free retains 1 day; app
  server logs are ephemeral (host log viewer).
- Backups: none automatic on the current tier — see
  docs/disaster-recovery.md for the manual routine.

## 7. Changes

Material changes to this policy will be announced in-app
before they take effect.
