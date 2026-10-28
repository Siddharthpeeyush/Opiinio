# Opiinio — Permissions matrix (Layer 4)

Source of truth for the app layer: `can()` in
`src/services/permissions.ts`. The database backstop is the RLS
policies in `supabase/migrations/20261029040000_rls.sql`; if this
matrix and the RLS file ever disagree, that is a bug to report, not
a rule to work around in an endpoint.

## Status codes (playbook rule)

- No user at all -> **401** (unauthenticated).
- Signed-in user asking for another user's **private** row
  (bookmarks, votes, mutes, blocks, reports, notifications) ->
  **404**, not 403 and not the data. A 403 would confirm the row
  exists.
- Signed-in user forbidden on a public row or a server-only table
  -> **403** (unauthorised).
- Helper: `deniedStatus()` in `src/lib/auth.ts`. Callers must pass
  `privateResource: true` only for the private tables below.

## Matrix

`—` = no policy / denied. "Own" = the row's owner id equals
`auth.uid()`. "Opinion author" = the author of the opinion a poll
belongs to. Follows delete is special: follower OR following.

| Table           | Read (visitor) | Read (user)   | Create                 | Update               | Delete                |
| --------------- | -------------- | ------------- | ---------------------- | -------------------- | --------------------- |
| profiles        | public         | public        | own id                 | own                  | own                   |
| daily_questions | public         | public        | — server only          | —                    | —                     |
| opinions        | public         | public        | own author             | own                  | own                   |
| replies         | public         | public        | own author             | own                  | own                   |
| opinion_votes   | —              | own (private) | own                    | own (change stance)  | own                   |
| opinion_likes   | public         | public        | own                    | —                    | own                   |
| reply_likes     | public         | public        | own                    | —                    | own                   |
| reposts         | public         | public        | own                    | —                    | own                   |
| follows         | public         | public        | own follower, not self | —                    | follower or following |
| polls           | public         | public        | opinion author         | —                    | opinion author        |
| poll_options    | public         | public        | opinion author         | —                    | —                     |
| poll_votes      | —              | own (private) | own                    | — locked             | own (undo)            |
| bookmarks       | —              | own (private) | own                    | —                    | own                   |
| muted_topics    | —              | own (private) | own                    | own                  | own                   |
| muted_words     | —              | own (private) | own                    | own                  | own                   |
| blocks          | —              | own (private) | own blocker, not self  | own                  | own                   |
| reports         | —              | own (private) | own reporter           | —                    | own                   |
| notifications   | —              | own (private) | — server only          | own (mark-read only) | —                     |

## Special rules (enforced in both DB and `can()`)

- **No self-follow, no self-block**: CHECK constraints in
  migration 01 and explicit checks in `can()` create.
- **One vote per user**: composite PKs (opinion_votes, poll_votes).
  Poll votes are locked once cast (no UPDATE policy); stance votes
  may be changed (UPDATE policy exists).
- **One repost per user per opinion**: UNIQUE (user_id, opinion_id);
  plain = quote_take NULL, Quote Repost = quote_take <= 280.
- **Block removes follow both ways**: trigger in migration 02;
  `can()` does not need to model it, but Layer 5 must not
  re-create a follow that a block removed.
- **Anonymous masking is not a permission**: an anonymous opinion
  is still publicly readable. Masking (`src/services/anonymous.ts`)
  strips author_id/handle to "Anonymous" in every response; it does
  not change who may read the row. Direct table reads must never be
  the app's read path for anonymous posts.
- **Notifications update is mark-read only**: Layer 5 must reject
  updates to any other field on a notification row, even for the
  owner. `can()` allows the update; field-level validation is a
  Layer 5 boundary rule.
- **Teams / organisations**: none. Every rule above is per personal
  `user_id`. There is no role, owner-transfer, or invite rule in V1.
