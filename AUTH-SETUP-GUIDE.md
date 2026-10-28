# Opiinio — Enabling Auth (Layer 4, dashboard steps)

Project: **opiinio** — https://moahibzipoyyheaceonp.supabase.co
Region: eu-west-1 (West EU, Ireland). Status: Healthy.

This guide enables Supabase Auth only. It does NOT apply any
migration and does NOT change any table. The Layer 4 code
(`src/lib/auth.ts`, `src/services/permissions.ts`,
`src/services/anonymous.ts`) is already written and pushed
separately; it does nothing live until the providers below are
enabled AND the Layer 4 migration (Step 4) is applied.

## What NOT to do

- **Do not share any secret in chat or in this repo**: no Google
  OAuth client secret, no Supabase service_role key, no database
  password, no anon key pasted as "proof". Paste secrets only
  into the Supabase dashboard fields they belong to.
- **Do not enable Phone / SMS auth.** It is billed, and the
  locked stack is email + Google only, ₹0 at launch.
- **Do not enable any other OAuth provider** (GitHub, Apple,
  Facebook, etc.) in V1. Google only, plus email.
- **Do not connect the GitHub field** on the project overview.
  That is Supabase's GitHub integration, not auth, and it is not
  needed for this build.
- **Do not run `supabase/seed.sql`.** It is seed-only test data
  with placeholder UUIDs, not for production.

## Step 1 — Email provider (do this first)

1. Open the opiinio project dashboard.
2. Left sidebar: **Authentication** → **Providers** (also shown
   as "Sign in / Providers" depending on dashboard version).
3. Find **Email** and enable it.
4. Keep **Confirm email** ON. This is email verification: a new
   user must click the confirmation link before the account is
   usable. Turning it off would let unverified accounts post,
   which V1 does not want.
5. Leave the email templates at Supabase defaults for now.
   Custom templates, sender domain, and SPF/DKIM/DMARC are a
   later (transactional-email) layer, not this step.
6. Save.

How verification works after this step: the user signs up with
email + password (Supabase Auth handles hashing — never hand
rolled), receives a confirmation email, clicks the link, and
Supabase marks the email confirmed and redirects to the Site URL
(Step 3). Only then does a session exist for `verifySession`
to accept.

## Step 2 — Google provider (your Google Cloud step)

Google OAuth needs a client that only you can create, because it
belongs to your Google account. The secret for it goes into
Supabase only, never into chat or git.

1. In a separate tab, open Google Cloud Console
   (console.cloud.google.com), create or select a project, and
   create an **OAuth 2.0 Client ID** (Web application type).
2. On the Google client, add this Authorized redirect URI
   **exactly** (this is Supabase's callback, not your app's URL):
   `https://moahibzipoyyheaceonp.supabase.co/auth/v1/callback`
3. Copy the Google **Client ID** and **Client Secret** from
   Google Cloud.
4. Back in Supabase: **Authentication** → **Providers** →
   **Google** → enable it, and paste the Client ID and Client
   Secret into the Google provider fields. Save.
5. If Google asks for a consent-screen app name / support email,
   use Opiinio and your own email. Publishing status (Testing vs
   Production) is your choice in Google Cloud; "Testing" limits
   sign-in to test users you add there, so for any real user
   beyond yourself you need Production (or added test users).

How Google sign-in works after this step: the user clicks
"Continue with Google", Google authenticates them, redirects to
the Supabase callback URL above, Supabase creates (first time)
or returns the auth user, and the profile trigger (Step 4)
creates their profile row. The app never sees the Google
password.

## Step 3 — URL configuration (do not skip this)

1. In Supabase: **Authentication** → **URL Configuration**.
2. **Site URL**: set this to the origin of the app that will
   receive users after email confirmation / password reset.
   - While the app is not yet deployed, use
     `http://localhost:3000` for local testing.
   - When the app is deployed (Netlify, later layer), change
     Site URL to that deployed origin. A Site URL that points
     nowhere is the most common reason a confirmation link
     "works" in Supabase but lands the user on a dead page.
3. **Redirect URLs** (Additional Redirect URLs): add every
   origin the app will actually run on, e.g.
   `http://localhost:3000` and, later, the Netlify URL.
   Redirects to origins NOT listed here are rejected by
   Supabase — that rejection is a security feature, not a bug.
4. Save.

Note the two different URLs, because they are easy to confuse:

- `https://moahibzipoyyheaceonp.supabase.co/auth/v1/callback`
  is Supabase's own OAuth callback (Step 2, Google side).
- Site URL / Redirect URLs are YOUR app's origins (this step).

## Step 4 — Apply the Layer 4 migration (profile trigger)

Only after Steps 1–3. Same SQL Editor flow as
`MIGRATION-GUIDE.md`, one file, in a new query:

| File                                                          | What it creates                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `supabase/migrations/20261029050000_auth_profile_trigger.sql` | `handle_new_user()` function + `on_auth_user_created` trigger on `auth.users` |

Wait for "Success" before testing signups. If a signup is
tested before this trigger exists, the user will sign in but
have no profile row, and own-row writes will fail — that is
the symptom that means "trigger not applied", not a code bug.

Verify the trigger exists (SQL Editor, optional but
recommended):

```sql
select trigger_name, event_object_table
from information_schema.triggers
where trigger_name = 'on_auth_user_created';
-- Expect: one row, event_object_table = users.
```

## Step 5 — Live cross-user proof (the Layer 4 verification)

This is the proof that file tests cannot give. Do it only after
Steps 1–4, with two real Auth users (create them via the app
signup once it exists, or via Dashboard → Authentication →
Users → Add user, then sign in as each).

For each check, record the actual HTTP status, not "it felt
blocked":

1. **Unauthenticated → 401.** With no session, request a
   protected action (e.g. create an opinion). Expect 401.
2. **Own private row → 200.** As User A, read User A's own
   bookmarks. Expect 200 with User A's rows only.
3. **Other user's private row → 404, not data, not 403.**
   As User A, request User B's bookmarks (change the id in
   the URL/body to User B's). Expect 404, and no User B data
   in the response.
4. **Other user's public row, forbidden write → 403.** As
   User A, try to update User B's opinion. Expect 403.
5. **Anonymous masking.** As User A, create an opinion with
   Anonymous ON, then read it as User B (or logged out).
   Expect author shown as "Anonymous", with NO author id,
   handle, or email of User A in the response.
6. **Profile auto-created.** After each signup, check
   `public.profiles` for a row with that user's id, a handle
   matching `^[a-z0-9_]{3,30}$`, and a display name. If a
   profile row is missing, Step 4 did not apply.

If any check returns a different status, stop and report the
exact status + request, do not hand-edit the database to
"fix" it.

## Password reset (how it works, no custom code)

- Supabase Auth provides password reset: the app calls
  Supabase's reset-password flow, Supabase emails a reset link,
  the user sets a new password. There is no custom reset token
  in this codebase, and none must be invented.
- Reset links expire per Supabase's Auth settings (email link
  expiry; check Authentication → Settings in the dashboard if
  you need the exact value for your project — do not guess it
  in the app copy).
- A reset link that has expired must show the user "link
  expired, request a new one", not a generic error and not a
  silent login.

## Step 6 — Two-factor authentication (TOTP, optional, free)

Yes — 2FA login/signup is available, as TOTP (authenticator app),
at no extra cost. TOTP MFA is enabled on every Supabase project
by default; it is not a paid add-on and needs no extra plan.

### Dashboard check (1 minute)

1. In Supabase: **Authentication** → **Multi-Factor
   Authentication**.
2. Confirm **TOTP** is enabled (it is the default). Leave it
   enabled.
3. Do NOT enable **Phone / SMS MFA**. That is a paid add-on and
   breaks the ₹0 / no-SMS-OTP rule for this build. The code in
   `src/lib/mfa.ts` deliberately has no phone-factor helper.

### How it works for a user (after Layer 6 screens exist)

1. **Enroll (optional, Settings):** the user opens Settings →
   Two-factor, scans the QR code (or enters the secret manually)
   in Google Authenticator / Authy / any RFC 6238 app, then
   enters the 6-digit code once to verify. The factor is NOT
   active until that verification succeeds — scanning alone
   does not turn 2FA on.
2. **Sign-in challenge:** on later sign-ins, after password (or
   Google) succeeds, Supabase asks for the current 6-digit code
   from the authenticator app. Only after that code verifies
   does the session reach `aal2` (second factor verified);
   password-only sessions are `aal1`.
3. **Sensitive actions need aal2 only if enrolled:** deleting
   the account, changing the password, or unenrolling MFA
   require an `aal2` session when the user already has an
   enrolled factor. A user with no factor enrolled is not
   forced into aal2 — that would be impossible to satisfy.
4. **Unenroll:** from an authenticated session, Settings →
   Two-factor → Remove, entering a current code if asked.
   That is the normal path; Layer 5 must gate it with
   `mayPerformSensitiveAction()` in `src/lib/mfa.ts`.

### Lost-device recovery (read this before enabling MFA)

- **No backup codes exist in Supabase MFA.** Do not tell users
  there are backup codes, and do not invent a backup-code
  system in this codebase.
- If a user loses their authenticator device AND is still
  signed in somewhere, they unenroll from that session
  (Settings → Two-factor → Remove).
- If they are fully locked out, recovery is an **admin
  unenroll in the Supabase dashboard**: Dashboard →
  Authentication → Users → select the user → find their MFA
  factors → unenroll the factor. That is a dashboard /
  service-role action, never client code, and it must be done
  only after verifying the user's identity by whatever
  process you choose outside this app.
- Because recovery depends on a human admin step, MFA stays
  **optional** at launch. Forcing it on all users would create
  lockouts with no self-service recovery.

### Layer 6 screens still needed (not built in Layer 4)

- Enroll screen: QR code + manual secret + verify-code input.
- Sign-in challenge screen: 6-digit code input after
  password/Google, shown only when the user has an enrolled
  factor and the session is still `aal1`.
- Settings MFA section: enrolled factors list, enroll, unenroll.
- Copy rules for those screens: never show the TOTP secret
  again after enrollment, never log a code, never claim backup
  codes exist.

### Live MFA proof (manual, after Layer 6)

1. Enroll an authenticator app, verify with a code, confirm
   the factor shows as verified in Dashboard → Authentication
   → Users → that user.
2. Sign out, sign in again: confirm a code is requested and
   the session reaches `aal2`.
3. With aal1 only (before entering the code), try a sensitive
   action: it must be refused.
4. Unenroll, confirm sign-in no longer asks for a code.

Until those steps are done live, MFA is code + mocked tests
only, not proven live — listed as skipped in the Layer 4
report.

## What is still NOT done after this guide

- **Layer 5 feature APIs** (opinions, replies, votes, follows
  endpoints with validation + `can()` on every operation) —
  next layer, not this one.
- **Frontend sign-in screens** — Layer 6. Until then, sign-in
  happens via Supabase's flows / dashboard test users, not via
  an Opiinio UI.
- **Rate limits on login/signup/reset** — later hardening
  layer (playbook: strictest on login/signup/reset).
- **Backup + tested restore** — later layer, still untested.
- **Anon key in the app**: the app's `.env` (never committed)
  needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` before any
  route calls `verifySession`. The guide deliberately does not
  tell you to paste the anon key anywhere in chat — put it in
  your local `.env` only, when Layer 5 asks for it.
