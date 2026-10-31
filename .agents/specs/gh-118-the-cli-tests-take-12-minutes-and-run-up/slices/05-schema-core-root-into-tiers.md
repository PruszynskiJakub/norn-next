---
id: gh-118/05
title: Schema, core and root tests into the unit tier and test/repo
depends_on: [ gh-118/03 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Schema and core tests sit in `test/unit/`; the repo rules, the process-setup test and the script tests (process check, golden) sit in `test/repo/`. The process check and golden script tests keep passing from their new place.

## Scope
Behaviour: B1, B19. Seams: S1, S3. Out: the tier-folder rule and the unit guard in the root config (slice 07).

## Acceptance
- AC1 (B1) Schema and core tests are under `test/unit/` with their fixtures, snapshots and the golden corpus at core's test root; root repo rules, process test and the script tests are under `test/repo/`; all pass under the unit guard. — verifier: test
- AC2 (B19) The golden script's own tests (stableKey, selectNew, decisionChanges, discovery) and the process check tests pass from `test/repo/`, and `bun run golden` still runs from the repo root. — verifier: test

## Checks
- `bun test`
- `bun run typecheck`

## Notes
D6. Runs in parallel with slices 04 and 06. Moving `test/repo.test.ts` while slice 06 edits it: git follows the rename; resolve by intent.
