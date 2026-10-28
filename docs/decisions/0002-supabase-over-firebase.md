# 0002 — Supabase (Postgres + Auth) over Firebase

- Context: User confirmed backend = Supabase free on 2026-10-29.
- Decision: Supabase Postgres + Supabase Auth (Google + email only,
  no SMS OTP).
- Alternatives considered: Firebase Firestore + Firebase Auth
  (rejected for V1: the playbook's migration/index/user-scoped-query
  discipline maps cleanly to SQL migrations and row-level security;
  a single Postgres schema is easier to audit). Firebase remains a
  valid fallback if Supabase free limits bite.
- Consequences: Migrations live in version control (later layer);
  auth is a proven provider, never hand-rolled; storage is unused in
  V1 (text-only).
