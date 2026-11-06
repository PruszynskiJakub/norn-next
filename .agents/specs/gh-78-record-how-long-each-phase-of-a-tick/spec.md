---
id: gh-78
slug: record-how-long-each-phase-of-a-tick
provider: gh
number: 78
url: https://github.com/PruszynskiJakub/norn-next/issues/78
title: Record how long each phase of a tick takes, so a slow tick can be explained
assignee: PruszynskiJakub
labels:
  - friction
  - norn
  - norn:kind:feature
  - norn:priority:low
  - norn:risk:medium
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-06T09:17:02.313Z
body_hash: 52dbb24b214216a6d41a4b4499f533e798d6e7de1de0dbe0ee226b9e95a3f59e
---

## Observed

The tick record does not say where a tick spends its time. `tick` and `tick.end` carry one `duration_ms` for the whole tick. Of the actions, only `run_check` records a time (`result.detail.duration_ms`, the check command's run time). Nothing else is timed: not observe, not decide, not other actions such as `claim.renew`. Observe's `SyncReport` (`ran`/`ok`/`error`) goes to `norn tick`'s output, not into the trace.

On 2026-10-28 (1226 ticks up to 10:34Z), ticks took a median of 1.4s, a p90 of 13.5s and a p99 of 27s. Claim renewals account for many of the slow ones (https://github.com/PruszynskiJakub/norn-next/issues/76). There were 70 ticks over 8s with no renewal and only `noop` actions. All 70 were remote-sync ticks (`facts.remote.issues` present). Every no-action sync tick took 8.6–10s, while no-action ticks without a sync had a median of 1.0s. So a remote sync costs about 9s, but the trace can't say which part: the base branch fetch, `fetchNornRefs`, `listAssignedIssues`, or the per-story `getIssue`/`findPullRequest` calls.

## Wanted

Every tick record carries how long each phase took, so a slow tick can be explained from the trace:
- `observe`, broken down: remote sync (base fetch, `fetchNornRefs`, issue/PR calls, with the number of calls), local facts, per-story git, runner, process.
- `decide`.
- Each action in `act`, with its time in its decision's `result` (e.g. `ms`), including `claim.renew`.
- The sync outcome (`SyncReport`) in the tick record.
- The new fields are optional in `TickTrace`/`TickUnitRecord` so older traces still validate. They stay out of `facts` and `action`, so `norn why` replays and `legacyAction` are unaffected and decide never reads them (core stays pure).
- A way to see a slow tick's slowest phase (today `norn trace` is per unit and `norn why` shows no timing), and the last tick's duration in the cockpit/status line.

## Repro

1. Run `norn watch` with a few stories claimed and a remote configured.
2. Pick a slow tick: `grep '"type":"tick.end"' .agents/norn/trace/<day>.jsonl | jq 'select(.duration_ms > 8000)'`.
3. Its `tick` record shows whether a sync ran (`facts.remote.issues`) but no timing below the whole tick, so you can't tell which fetch, remote call or action took the time.
