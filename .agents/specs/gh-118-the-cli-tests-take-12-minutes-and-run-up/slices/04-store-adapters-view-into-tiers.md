---
id: gh-118/04
title: Store, adapters and view tests into unit and integration
depends_on: [ gh-118/03 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: agent }
---

## Goal
Store, adapters and view tests each sit in `test/unit/` or `test/integration/`, so their real-git and real-process tests leave `bun test` and run in `bun run test:integration`. Mixed files are split.

## Scope
Behaviour: B1, B5, B17 (these packages). Seams: S1, S4. Out: cli (slice 03), schema/core/root (slice 05).

## Acceptance
- AC1 (B1, B17) Every test file of store, adapters and view sits under `test/unit/` (per-adapter subfolders kept as `unit/<adapter>/`) or `test/integration/` (`integration/<adapter>/`), fixtures move with their tests, and package-local helpers (store's tmp helpers, contract suites) stay at the package's test root; the rule "every adapter has tests" reads both tiers. — verifier: test
- AC2 (B4, B17) Every file under these packages' `test/unit/` passes under the unit guard; a mixed file (e.g. store refs, worktree) becomes a unit file with its pure tests and an integration file with its spawning tests. — verifier: test
- AC3 (B17) Per package, the test count before and after the slice is equal (unit + integration), each split listed in the handoff with its counts. — verifier: agent

## Checks
- `bun test`
- `bun run test:integration`
- `bun run typecheck`
- `bun test --preload ./test/support/unit-guard.ts packages/store/test/unit packages/adapters/test/unit packages/view/test/unit`

## Notes
D5's list is the starting point (adapters git and contract, store refs/spawn/snapshot/worktree/defects/leases-lock/files, view's view and steps are integration or split); the guard decides. The guard's path in the check is where slice 02 put it; adjust the check to that path. Runs in parallel with slices 05 and 06.
