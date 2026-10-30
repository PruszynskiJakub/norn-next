---
id: gh-107/07
title: A run's hook facts stored once in fixed 64-fact blocks
depends_on: [gh-107/06]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
A long agent step makes the trace grow linearly with its hooks: each run's hook list is stored as fixed blocks of 64 facts written once, and a tick adds only the last partial block when it changed.

## Scope
Behaviour: B14 (and B17 kept). Seams: S2, S1. D7's `$blocks` part. Out: anything else about chunks (06).

## Acceptance
- AC1 (B14) Given a run with 416 hook facts appended over its life, when its ticks are written, then 6 full blocks are each written once, and each later tick adds only the last partial block when it changed. — verifier: test
- AC2 (B14, B17) Given chunked ticks whose runs carry `$blocks` references, when `norn why --tick <id>` runs, then the rebuilt facts equal the observed facts byte for byte and decide gives the recorded decisions. — verifier: test

## Checks
- `bun test packages/store/test/config-trace.test.ts`
- `bun test packages/cli/test/why-version.test.ts packages/core/test/golden.test.ts`
- `bun run typecheck`

## Notes
Blocks are cut by position in the run's refined hook list; Claude's refinement looks only backwards, so full blocks stay stable (D7). A late hook simply makes a new block.
