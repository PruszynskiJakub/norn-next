---
id: gh-186
slug: speed-up-ticks-parallel-observe-batched
provider: gh
number: 186
url: https://github.com/PruszynskiJakub/norn-next/issues/186
title: "Speed up ticks: parallel observe, batched ref reads and remote sync"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:chore
  - norn:priority:medium
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: active
intake_at: 2026-11-06T15:42:12.222Z
body_hash: b49934d86c01a311fa9d516dd6def62a4c05f548dbb5318d9f3ad8271aaae938
---

## Observed

Ticks are slow even with nothing to do (traces of 2026-11-03: noop ticks average 1.36 s, max 8.5 s; ~8 s spikes about every 5 min from remote sync). Part of the floor is gone since #247 (c207e7c01): stories are read 4 at a time, every claim and mailbox comes from one `for-each-ref` + one `cat-file --batch`, a worktree's status/lastCommitTime/inProgress run together, and sync's per-story `getIssue`/`findPullRequest` run 4 at a time. What is left:

- **Sync still makes O(stories) PR calls.** Each active story still costs one `findPullRequest` (plus `getIssue` when not in the assigned list), and each story held elsewhere one more. There is no remote port method that lists open PRs once.
- **`mergedByAncestry` runs one story after another** (`packages/cli/src/runtime/observe/index.ts:432-436`), awaited in turn.
- **Units inside one story run one after another** (`index.ts:298`): per unit `wtFacts`, `unitFacts` (pid probe, pane state), `isAncestor`, `foreignCommits`, each awaited in turn.
- **One `ps` per live pid** (`packages/cli/src/runtime/observe/run-facts.ts:87,100`, `ports.process.isAlive`), not one call for all.

## Wanted

A sync tick that makes O(1) PR calls instead of O(stories), and noop ticks measurably under today's floor. Facts do not change. Measure against #78's per-phase timings once it lands.

- A remote port method that lists open PRs once (`gh pr list --json headRefName,…` and the glab equivalent), matched to stories by branch, replacing one `findPullRequest` per story in `syncRemote` (`index.ts:199`) and for the stories held elsewhere. The gh and glab adapters, `FakeRemote` (`test/support/harness.ts:65`) and `remoteContract` (`packages/adapters/test/contract/remote.ts`) change with it, plus a new contract case.
- `mergedByAncestry` checks run through `mapBounded` (`packages/cli/src/runtime/observe/bounded.ts`) like the other per-story reads.
- Optionally: a story's units read in parallel, and every live pid checked with one `ps` call.

Constraints:
- Golden cases and observe snapshots stay unchanged; a diff there is a bug. An intended effect-transcript rewrite is expected where the calls change.
- A sync failure still leaves remote facts unobserved, and the per-call `.catch(…)` fallbacks behave as today.

## Where

- `packages/cli/src/runtime/observe/index.ts:199` `syncRemote` (`:217` per active story, `:227` held elsewhere); `:432` `mergedByAncestry` loop; `:298` per-unit loop; `:73-74` `GIT_CONCURRENCY`/`REMOTE_CONCURRENCY`
- `packages/core/src/ports.ts:341,343` `getIssue`, `findPullRequest`
- `packages/adapters/src/gh/index.ts:127`, `packages/adapters/src/glab/index.ts:134` `findPullRequest`
- `packages/cli/src/runtime/observe/run-facts.ts:87,100` pid probes

## Rules

H2 (what observe collects), H5 (remote calls throttled, never blocking local reads), GR1 (sync). No rule changes; behaviour stays the same.


Related: #187 (the push side of slow acting ticks).
