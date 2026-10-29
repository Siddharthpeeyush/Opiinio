# Opiinio pre-launch checklist

Status: final layer (0017). Every remaining item, with owner and
honest status. **Nothing is marked done that isn't.** The
playbook build is complete after this layer; what remains is
the owner's dashboard steps, undecided product calls, and
launch-day verification.

## A. Owner's dashboard steps (Supabase / Google / Netlify)

| #   | Item                                                                                                                                                                                                                     | Owner                        | Status                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------- |
| A1  | Enable Email provider + "Confirm email" ON in Supabase Auth                                                                                                                                                              | owner                        | pending                                                   |
| A2  | Create Google OAuth client (Google Cloud), paste client ID/secret into Supabase, enable Google provider                                                                                                                  | owner                        | pending — secret goes into Supabase only, never chat/repo |
| A3  | Apply migration 05 (`20261029050000_auth_profile_trigger.sql`) live in SQL Editor                                                                                                                                        | owner                        | pending                                                   |
| A4  | Put `SUPABASE_URL` + `SUPABASE_ANON_KEY` in local `.env` (never commit; never the service_role key)                                                                                                                      | owner                        | pending                                                   |
| A5  | Confirm TOTP MFA enabled (Supabase → Authentication → MFA)                                                                                                                                                               | owner                        | pending                                                   |
| A6  | Create 2 real Auth users; run live cross-user proof (`AUTH-SETUP-GUIDE.md` §5: 401 unauthenticated, own private row 200, other's private row 404, other's public-row write 403, anonymous masking, profile auto-created) | owner (+ assistant guidance) | pending                                                   |
| A7  | Live MFA proof (real authenticator enroll → sign-in challenge to aal2 → aal1 sensitive-action refusal → unenroll)                                                                                                        | owner                        | pending                                                   |
| A8  | Create `opiinio-staging` Supabase project; apply all 5 migrations there                                                                                                                                                  | owner                        | pending                                                   |
| A9  | Connect Netlify: staging site (auto-deploy on merge), production site (manual publish only)                                                                                                                              | owner                        | pending                                                   |
| A10 | Set env vars per site per `docs/hosting.md` matrix; verify `/api/health` shows the right `appEnv` on each                                                                                                                | owner                        | pending                                                   |
| A11 | Billing alerts on Supabase + Netlify (set the day the projects/sites exist)                                                                                                                                              | owner                        | pending                                                   |
| A12 | First backup: run the manual `pg_dump` routine from `docs/disaster-recovery.md`                                                                                                                                          | owner                        | pending                                                   |

## B. Product decisions only the owner can make

| #   | Item                                                                                     | Status                                                         |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| B1  | Custom domain: check Opiinio availability; buy only with separate approval + exact price | UNDECIDED                                                      |
| B2  | Age threshold in Terms: 13+ vs 18+                                                       | UNDECIDED                                                      |
| B3  | Anonymous-mode abuse control: 1/day limit at launch vs review queue first                | UNDECIDED                                                      |
| B4  | Monetization implementation (ads, sponsored debates, premium)                            | NOT APPROVED — plan explained, implementation is a later layer |
| B5  | Native app / App Store listing                                                           | NOT APPROVED                                                   |

## C. Verification still owed (assistant + owner)

| #   | Item                                                                                                         | Status                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| C1  | First CI run green on `main`                                                                                 | in progress — rerun pending after the hosting-layer push |
| C2  | Push this final layer to GitHub                                                                              | pending owner's "push" instruction                       |
| C3  | E2E on staging with a real browser (signup → post → reply → vote → MFA)                                      | pending (needs A8–A10)                                   |
| C4  | Load test against staging (p50/p95/p99 + error rate at expected launch traffic)                              | pending (local run done in 0017)                         |
| C5  | Human visual screenshot pass (all screens, 390px + desktop)                                                  | pending — owed since Layer 6                             |
| C6  | Screen-reader / keyboard audit                                                                               | pending — owed since Layer 6                             |
| C7  | Full GitHub history secret scan (the 8+ pushed commits were built clean, but no systematic history scan yet) | pending — pre-launch follow-up from 0014                 |
| C8  | Restore drill (docs/disaster-recovery.md procedure, untested)                                                | post-launch                                              |

## D. Known gaps carried past launch (documented, not hidden)

- Direct PostgREST with the anon key bypasses anonymous masking
  (app API is the only masked path) — decision 0011/0012.
- Account deletion: aal-gated but `403 SERVER_ONLY` — a future
  admin layer, never service_role in this repo.
- Rate-limit store is in-memory (single process); bucket values
  are starting values — tune after real traffic.
- Following tab / Profile Replies tab / Profile Likes tab have
  no live route yet (honest empty states in the UI).
- People to Discover absent pending its privacy review.
- Alert thresholds are starting values; first tuning after
  launch traffic.

## E. Playbook Layer-16 items deferred past V1 (recorded, not forgotten)

- Transactional email (SPF/DKIM/DMARC): not needed — Supabase
  Auth sends its own auth emails; the app sends none.
- Product analytics: no tracker by privacy rule; server logs
  are the analytics until a privacy-reviewed decision says
  otherwise.
- Feature flags, onboarding tour, i18n beyond the chrome
  Hindi toggle: deferred, not V1.
- Status page: post-launch (docs/monitoring.md).
