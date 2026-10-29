# Testing strategy — Opiinio

Status: Layers 7–8. What exists, what the rules are, and what is
still owed. This is the playbook's test-strategy layer, adapted to
the Opiinio stack (Node 24, TypeScript strict, modular monolith,
`node:test`, Supabase free).

## What exists now

- **Unit + integration tests via `node:test`** (`tests/`, 159 tests
  and counting). `npm test` builds (`tsc`) then runs
  `node --test dist/tests/*.test.js`.
- **Fake store, never a real DB in tests.** `tests/fake-store.ts`
  implements the `Store` interface in memory; GoTrue is a fetch
  stub. Tests prove route logic, auth gating, `can()` decisions,
  validation, rate-limit wiring, and serialization — they do NOT
  prove live RLS. Live RLS was proven once, by hand, in the
  Supabase SQL Editor (Layer 3 verification: 18 tables, RLS on all
  18, policies ≥ 1, the 280-char check).
- **Live-server proofs with placeholder env.** Where a layer needs
  to show the HTTP surface behaves (health stays app-scope,
  `/api/docs` → 404, rate-limit 429s before GoTrue), the builder
  starts the real server with placeholder env values and curls it.
  No real Supabase call is made; the sandbox has no egress, so
  GoTrue-unreachable paths return the generic 503. These proofs
  are recorded in the layer's decision record, never claimed as
  live-user tests.
- **Secret-scanner tests** (`tests/secret-scanner.test.ts`): the
  scanner exits 0 on the clean tree (calibrated against this
  repo's idioms — variable references, type annotations, fake
  fixtures, placeholder values) and 1 on planted fakes, and never
  echoes a secret value.

## Rules (standing, per the playbook)

1. **Bug-first.** Every future bug gets a failing test that
   reproduces it BEFORE the fix is written. Show the test failing,
   fix the code, show it passing, show the full suite green.
2. **Don't-fool-me report per change.** Actual lint / typecheck /
   test output; full files created/changed and why; explicit
   skipped / stubbed / mocked lists; assumptions the user should
   confirm.
3. **Never edit a test to make it pass.** A failing test is a
   report, not an obstacle. Fix the code or fix the wrong
   expectation with a recorded reason — never silently weaken an
   assertion.
4. **Zero skipped, zero failing at every layer boundary.** Work
   is not complete with a skipped test.
5. **Mock only the outside world** (GoTrue HTTP, the Postgres
   wire). Never mock the auth check, the permission check, or the
   validator under test.
6. **Tests must not contain real secrets.** Fixtures that need a
   secret-shaped value use obviously fake values split across
   string parts so the secret scanner stays green on the tree.

## Cross-user / cross-tenant expectations

Every API route family is tested against this matrix (established
in Layers 4–5, kept green since):

| Caller                                                                                          | Expected                                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| No token / rejected token on a write                                                            | 401                                                                  |
| Authenticated user, other user's private row (bookmarks, mutes, blocks, reports, notifications) | 404 (not 403 — no existence signal)                                  |
| Authenticated user, other user's public row, write attempt                                      | 403                                                                  |
| Authenticated user, own row                                                                     | 200 / as designed                                                    |
| Anonymous-authored content                                                                      | author masked (`author_id` null, "Anonymous") in every response path |
| Votes / likes                                                                                   | aggregates + caller's own status only; no voter-list route exists    |

The 404-for-other-user's-private-row rule is deliberate: it is the
anti-enumeration half of the standing privacy rule.

## Test-quality review (what to watch for)

When reviewing the suite, report:

- tests that would still pass if the feature were broken
  (assertions on mocks only, no behavior asserted);
- tests that assert on mock internals rather than route output;
- skipped or flaky tests (none are allowed to stay);
- important paths with no coverage — current known thin spots:
  the frontend `public/app.js` live loaders are tested
  statically + against route wiring, not against a real
  signed-in browser session (needs the two live Auth users,
  a user dashboard step);
- the secret scanner's dictionary-word heuristic (a real secret
  containing a fake-looking word could slip past — see
  `docs/decisions/0014-ci-cd-testing.md`).

## What remains owed (later layers, not this one)

- **E2E with a real browser against staging**, once providers are
  enabled live and the anon key exists: sign-up, sign-in, TOTP
  MFA enroll + challenge to aal2, post an opinion, reply, vote,
  repost, follow, poll vote, bookmark, block/mute/report, and the
  two-user cross-user proof live (unauthenticated 401, own
  private row 200, other user's private row 404, other user's
  public-row write 403, anonymous masking, profile auto-created
  on signup).
- **Load tests** (p50/p95/p99 + error rate + degradation point)
  against staging — a later operate-and-scale layer.
- **Accessibility audit** (keyboard, screen reader, contrast) of
  the editorial frontend — owed before launch; current state is
  the WCAG effort recorded in Layer 6 (labels, focus-visible,
  aria-pressed/selected, skip link), not a finished audit.
- **CI live run**: `.github/workflows/ci.yml` is validated
  structurally only; the first real Actions run happens after
  the workflow file is pushed and a PR/push triggers it.
