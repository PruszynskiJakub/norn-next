---
id: gh-107/04
title: Hook facts land in and are read from per-unit hook files
depends_on: [gh-107/02]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: agent }
---

## Goal
Each hook fired in a unit worktree is also appended to that unit's hook file, and ticks, `norn hook` and `brief` read only the hook files of the units they concern — never the day files — so their cost no longer grows with the trace.

## Scope
Behaviour: B5, B6, B7, B8, B9, B10. Seams: S1. D3, D4. PRD: amend A2 (hook facts also go to the unit's hook file) and A4 (blocked count from the unit's file). Out: copying hook lines of runs that were live before the upgrade (05).

## Acceptance
- AC1 (B5) Given a unit worktree for gh-9, when a `PostToolUse` hook fires there, then one line lands in gh-9's hook file and the same line in today's day file, and `norn trace gh-9` shows it. — verifier: test
- AC2 (B6) Given the repo's main checkout (no unit worktree), when a hook fires there, then nothing is traced and no hook file is created. — verifier: test
- AC3 (B7) Given gh-9's worktree, when a hook without a run id (e.g. session start) fires there, then a line lands in gh-9's hook file. — verifier: test
- AC4 (B8) Given a live run on gh-9 and hook lines for other units in the day files, when a tick runs, then it reads gh-9's hook file (and the hook files of units changed within `limits.stalled`), the trace-read observer sees no day file opened to collect hook facts, and it decides the same as before (observe snapshots and golden unchanged). — verifier: test
- AC5 (B9) Given a run on gh-9 that has reached the blocked-hook limit (A4), when the next blocked hook fires, then `norn hook` gives the same answer as before and no day file is opened. — verifier: test
- AC6 (B10) Given hook facts for gh-9 and other units, when `norn brief` runs in gh-9's worktree, then it reads only gh-9's hook file for hook facts and no day file. — verifier: test
- AC7 (B10) Given the synthetic 2 GB trace from 03's benchmark script, when `norn brief` runs in the live unit's worktree, then it answers in about the same time as with an empty trace. — verifier: agent

## Checks
- `bun test packages/cli/test/agent-protocol.test.ts packages/cli/test/observe-snapshots.test.ts packages/cli/test/e2e.test.ts packages/cli/test/recovery.test.ts`
- `bun test packages/core/test/golden.test.ts`
- `bun run typecheck`

## Notes
Risk "hook routing parity": run the observe snapshots and the golden harvest before and after; facts without a run id were matched by worktree and start time, and must keep exactly the facts observe saw. Readers of a hook file drop duplicate event ids and sort by `at` (D3). Builds on the unit-scoped hook read from 02: only its implementation changes. If 03's benchmark script has not landed yet, AC7 waits for it (no edge: it does not gate the code).
