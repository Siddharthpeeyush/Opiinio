# Opiinio — Security Threat Model (Layer 10)

V1 threat model. Assets, trust boundaries, and the OWASP-style
threats per entry point, with mitigations present and mitigations
missing. Honest gaps are recorded, not hidden. Updated per layer;
see docs/decisions/0015-security-review.md.

## Assets

1. **User identities** — Supabase Auth users, sessions, TOTP
   factors. Losing one hands an attacker the whole account.
2. **Opinions and replies**, including **anonymous** ones — the
   author's identity on an anonymous post is the most sensitive
   link in the product.
3. **Votes, likes, follows** — who agreed with what. Never
   exposed as voter lists (vote aggregates only), by the
   standing privacy rule.
4. **Private tables** — bookmarks, muted topics/words, blocks,
   reports, notifications. Own-only, always.
5. **MFA factors** — enrollment secret + QR, shown once.
6. **The anon key** — client-safe by design; anyone can hold
   it. Security must not depend on hiding it.

## Trust boundaries

```
browser (untrusted input) ── same-origin ──> app server (trusted code)
                                                  │
                                   ┌──────────────┴──────────────┐
                                   v                             v
                             GoTrue (auth)                 PostgREST (data, RLS)
```

- The browser is untrusted: all input is validated at the
  boundary (Layer 5), all output is escaped (frontend).
- The app server is the only code that calls GoTrue with the
  anon key; the frontend never calls GoTrue/PostgREST
  directly (proven by tests).
- Supabase is trusted for auth and storage, but the anon key
  is public — RLS is the backstop, not the whole story (see
  open items).

## Threats by entry point

### 1. Public API reads (`GET /api/opinions`, search, profiles)

| Threat (STRIDE-lite)                     | Likelihood                              | Impact   | Mitigation present                                                                                           | Missing / open                                                                                                                                                |
| ---------------------------------------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mass scraping (DoS/abuse)                | Medium                                  | Medium   | Pagination caps (20/50), search ≤100 chars, body ≤64KB, Layer 11 rate limits (read 300/5min, search 60/5min) | Shared IP false positives unproven until real traffic                                                                                                         |
| Anonymous de-anonymization via author_id | Low (app) / **High (direct PostgREST)** | **High** | App API masks every response path; author rows not even loaded                                               | **OPEN:** direct PostgREST with the anon key bypasses masking — recorded in 0009, restated in 0015. Hardening decision still owed (server-only view/function) |
| IDOR / cross-tenant read                 | Medium                                  | High     | `can()` on every route + RLS on all 18 tables + cross-user tests (401/403/404)                               | Live RLS proof still owed (two real Auth users, AUTH-SETUP-GUIDE §5)                                                                                          |
| Enumeration oracles                      | Low                                     | Medium   | No profile list, no user search, no handle/email-taken endpoints; generic errors                             | —                                                                                                                                                             |

### 2. Auth routes (`/api/auth/*`)

| Threat                             | Likelihood | Impact | Mitigation present                                                                                                                             |
| ---------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential stuffing / brute force  | Medium     | High   | Layer 11: signup/signin/reset 5/15min, dual-keyed on hashed email + hashed IP; generic 401, no account oracle                                  |
| Session theft (token exfiltration) | Low        | High   | sessionStorage only (never localStorage); no cookies; tokens never in logs, URLs, or responses except the caller's own session                 |
| MFA bypass                         | Low        | High   | TOTP only (no SMS); aal-gating on password change / MFA unenroll / account delete via mayPerformSensitiveAction; secrets shown once, discarded |
| Password-reset abuse (email flood) | Medium     | Medium | Rate-limited 5/15min; always {sent:true} (no email oracle)                                                                                     |
| Fake OAuth redirect                | Low        | Medium | No redirect_to invented by the app; Supabase dashboard holds the callback; Google client is user-created                                       |
| Account deletion pretending        | N/A        | —      | Route is honest: aal-gated, then 403 SERVER_ONLY. Never describes a user as deleted. Admin layer is a future item, not this one.               |

### 3. Write routes (opinions, replies, votes, likes, reposts, follows, polls, mutes, blocks, reports)

| Threat                              | Likelihood | Impact | Mitigation present                                                                                                                                                                  |
| ----------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged identity (acting as another) | Medium     | High   | Identity from the verified session only; `author_id`/`user_id` in bodies rejected or ignored; one-per-user enforced by DB constraints + 409                                         |
| Spam / flooding                     | Medium     | Medium | Write bucket 60/5min; 280-char limits; anonymous posts still carry stored author_id for moderation                                                                                  |
| Poll manipulation                   | Low        | Low    | Votes locked (no update), one per user, option must belong to its poll                                                                                                              |
| CSRF                                | Low        | Low    | Auth is Bearer (not cookies); same-origin CORS, never `*`; no `Access-Control-Allow-Credentials`. State explicitly: CSRF is not a V1 threat because there is no ambient credential. |
| Block/mute bypass (harassment)      | Medium     | Medium | Block removes follows both ways (DB trigger); mutes hide content everywhere; all undoable; anonymous posting does not bypass blocks (block is per author row)                       |

### 4. Logs and error paths

| Threat                                     | Likelihood | Impact | Mitigation present (Layer 10 review)                                                                                                                                                                             |
| ------------------------------------------ | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/password/token/IP/MFA-secret in logs | Low        | High   | `src/lib/log.ts` is redacted BY CONSTRUCTION — the LogEntry type has only requestId, route pattern, method, status, userId. Proven by `tests/security.test.ts` (a fake login payload cannot reach the log line). |
| Stack traces / SQL / paths in errors       | Low        | Medium | Single generic error shape (`src/lib/http.ts`); `toApiError` maps everything unknown to INTERNAL_ERROR; 429 bodies carry no personal data.                                                                       |
| Health endpoint detail leak                | Low        | Low    | App-scope only; auth/database report not_configured, never ok without a real check.                                                                                                                              |

### 5. Supply chain (dependencies)

| Threat                         | Mitigation present                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compromised runtime dependency | **Zero runtime dependencies** — the deployed server runs plain Node stdlib only (`node:crypto`, `node:test`, global fetch). There is nothing to compromise at runtime.                                                             |
| Compromised build/test tooling | 6 dev-only deps (typescript, eslint, prettier, typescript-eslint, @eslint/js, @types/node). `npm audit --offline` (cached advisories): **0 vulnerabilities**. Dev deps never ship to users; they run at build/lint/test time only. |
| Typosquatting / lockfile drift | `package-lock.json` committed (124 packages pinned); CI runs `npm ci`, never `npm install`.                                                                                                                                        |

### 6. Frontend (`public/app.js`)

| Threat                                  | Mitigation present                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| XSS via opinion/reply/profile text      | `esc()` on every untrusted field entering HTML (opinion id/body/topic, author names/handles/initials, poll option text, muted words/topics, factor names). Swept in Layer 10 — no raw sink remains except the one below. |
| XSS via MFA QR SVG (GoTrue-provided)    | **Fixed in Layer 10:** `safeSvg()` allow-lists SVG with no `<script`, no event-handler attributes, no `javascript:` URLs, no `<foreignObject>`/`<iframe>`. The only raw innerHTML sink is now guarded.                   |
| XSS via counts in HTML                  | Counts are numbers (`Math.round` in `pct()`) or concatenated as text nodes — no attribute injection.                                                                                                                     |
| Secret/URL exfiltration from the client | No Supabase URLs, no anon/service_role key, no localStorage, no third-party scripts/fonts/trackers — proven by tests. Session lives in sessionStorage only.                                                              |
| Clickjacking                            | `X-Frame-Options: DENY` on API responses (Layer 5).                                                                                                                                                                      |

## What is still open (not hidden)

1. **Direct-PostgREST anonymous-masking bypass** — the largest
   remaining privacy gap. Restated, not re-solved: a hardening
   decision (server-only view/function for anonymous rows) is
   owed before launch.
2. **Live RLS proof** — two real Auth users, cross-user
   401/403/404, per AUTH-SETUP-GUIDE §5. Mocked tests prove
   route logic, not live RLS.
3. **Penetration test** — not done; out of scope for V1.
4. **E2E security testing** — needs staging + real users
   (signup → attack own session → verify boundaries).
5. **Shared-IP false positives** on rate limits — cannot be
   proven until real users arrive; watch-signal documented in 0013.
6. **Full GitHub history secret scan** — recorded as a
   pre-launch follow-up in 0014.
7. **Account deletion completion** — future admin layer only;
   never wire service_role into this codebase.
