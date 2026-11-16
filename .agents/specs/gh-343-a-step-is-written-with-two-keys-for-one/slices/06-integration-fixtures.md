---
id: gh-343/06
title: Move the cli integration tests' workflow fixtures to the new wording
depends_on: [ gh-343/04 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Expand–contract migration batch: every workflow the cli integration tests write into a test repo's main checkout is in the new wording, so refusing the old wording there (slice 09) leaves them green. No behaviour changes.

## Scope
User stories: none new; keeps the suite green for the old-wording refusal. Seams: S6, S7 (their harness). Out: tests that deliberately need an old-wording file (pins, branch files, upgrade input) keep it; other test tiers (slice 07).

## Acceptance
- AC1 Given the cli integration suite, when it runs in CI, then it passes, and no test writes an old-wording workflow or shared file into a main checkout except where the test is about the old wording. — verifier: test
- AC2 Given each migrated test, when compared with before, then it asserts the same behaviour (same commands, same expected outputs), only the fixture's wording changed. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
About 68 files. Rewrite mechanically with the slice 03 translator where a fixture is plain text, then tidy by hand; a shared helper in `test/support/` that writes a workflow may move many at once. The integration tier runs only in CI, not locally: the implementer's local loop is `bun run test` plus typecheck, and CI proves AC1.
