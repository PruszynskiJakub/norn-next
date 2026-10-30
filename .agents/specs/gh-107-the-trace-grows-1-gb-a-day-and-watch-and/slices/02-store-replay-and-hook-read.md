---
id: gh-107/02
title: Replay inputs and unit hook facts read through store
depends_on: [ gh-107/01 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
`norn why`, the golden harvest, the tick, `brief` and `hook` read a tick's decide inputs and a unit's hook facts through one store read each, with nothing a person sees changed — so the chunks (06) and hook-file (04) slices each change one function.

## Scope
Behaviour: B18 (as the parity it must keep), B9, B10 (parity only). Seams: S1, S2. Prefactoring 2 (replay-input rebuild moves from the cli tick runtime into a store read of a tick's decide inputs) and 3 (one unit-scoped hook-fact read used by the tick's local facts, `brief` and `hook`'s blocked count, still over the day files). Out: hook files (04), chunks (06).

## Acceptance
- AC1 (B18) Given ticks recorded in the trace, when `norn why --tick <id>` runs on each, then it replays as before, and the golden test passes with the corpus unchanged. — verifier: test
- AC2 (B9) Given a run on a unit that has hit the blocked-hook limit (A4), when the next blocked hook fires, then `norn hook` answers as before. — verifier: test
- AC3 (B10) Given hook facts in the trace for two units, when `norn brief` runs in one unit's worktree, then it shows the same hook-derived context as before, and the tick decides the same as before (observe snapshots and effect transcripts unchanged). — verifier: test

## Checks
- `bun test packages/core/test/golden.test.ts`
- `bun test packages/cli/test/why-version.test.ts packages/cli/test/inbox-why.test.ts packages/cli/test/agent-protocol.test.ts packages/cli/test/observe-snapshots.test.ts`
- `bun run typecheck`

## Notes
A pure prefactor: a slice that changes no output. If the golden corpus, a transcript or an observe snapshot would need rewriting, the move changed behaviour; fix the move, do not update the pins.
