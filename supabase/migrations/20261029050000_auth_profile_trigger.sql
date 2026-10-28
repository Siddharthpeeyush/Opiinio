-- Opiinio Layer 4 — Migration 5: profile row on auth signup
--
-- NOT APPLIED LIVE in the Layer 4 code step. Apply it in the
-- Supabase SQL Editor (same flow as MIGRATION-GUIDE.md) AFTER the
-- Layer 3 migrations, and only after Auth providers are enabled
-- (see AUTH-SETUP-GUIDE.md). Re-running is safe: the function is
-- CREATE OR REPLACE and the trigger is dropped and re-created.
--
-- What it does: when Supabase Auth inserts a row into auth.users
-- (email signup confirmed, or Google OAuth first sign-in), this
-- trigger inserts exactly one matching row into public.profiles.
-- Without it, a signed-in user would have no profile row, and
-- every own-row policy that joins on profiles would fail.
--
-- Handle derivation (must satisfy profiles.handle check
-- ^[a-z0-9_]{3,30}$ from migration 01):
--   1. Take the part of the email before "@", lower-case it, and
--      replace every character that is not a-z, 0-9, or "_" with "_".
--   2. Truncate to 30 characters.
--   3. If the result is shorter than 3 characters (or the email is
--      missing, as with some OAuth accounts), fall back to
--      "user_" + the first 8 hex characters of the auth user id
--      (13 characters, always valid).
--   4. If the handle is already taken, append "_2", "_3", …,
--      truncating the base so the candidate stays <= 30 chars.
--      The loop gives up after 9999 attempts rather than looping
--      forever; that failure must be reported, not worked around.
-- Display name: raw_user_meta_data full_name, else name, else the
-- email prefix, else "Opiinio user", truncated to 80 characters.
--
-- Initials: NOT stored. There is no initials column in migration 01.
-- Initials are derived at render time from display_name by
-- initialsFor() in src/services/anonymous.ts, and anonymous posts
-- always use the generic "AN". Storing initials would duplicate the
-- name and drift when the name changes.
--
-- SECURITY DEFINER: the trigger must insert into public.profiles
-- even though a brand-new user has no session yet and the profiles
-- INSERT policy requires auth.uid() = id. A plain trigger function
-- would be blocked by RLS; SECURITY DEFINER lets this one function
-- — and only this function — bypass RLS for exactly this insert.
-- It inserts only the new user's own row, never another user's,
-- and it never reads or returns any secret.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_email text := new.email;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base text;
  candidate text;
  suffix integer := 0;
  display_name text;
begin
  base := lower(
    regexp_replace(
      coalesce(split_part(raw_email, '@', 1), ''),
      '[^a-z0-9_]', '_', 'g'
    )
  );
  base := left(base, 30);
  if base is null or char_length(base) < 3 then
    base := 'user_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  candidate := base;
  while exists (select 1 from public.profiles where handle = candidate) loop
    suffix := suffix + 1;
    if suffix > 9999 then
      raise exception 'could not generate a unique handle for new user';
    end if;
    candidate := left(base, 26) || '_' || suffix::text;
  end loop;

  display_name := coalesce(
    nullif(meta ->> 'full_name', ''),
    nullif(meta ->> 'name', ''),
    split_part(raw_email, '@', 1),
    'Opiinio user'
  );
  display_name := left(display_name, 80);
  if display_name = '' then
    display_name := 'Opiinio user';
  end if;

  insert into public.profiles (id, handle, display_name)
    values (new.id, candidate, display_name)
    on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
