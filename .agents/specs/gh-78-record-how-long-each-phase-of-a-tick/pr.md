## Summary

Every tick record now says where the tick spent its time, so a slow tick can be explained from the trace. The record holds observe's phases and the sync's remote call counts, plus the time for decide, each action and the work after act. It also holds the sync outcome. `tick.end` and `norn tick` name the slowest phase, and `norn story list` and the cockpit header show how long the last tick took.

```diff
 tick record
   facts, decisions[].action            # unchanged: decide and --why replays read only these (O5)
+  decisions[].result.ms                # each action's time, claim.renew included
+  sync: { ran, ok, error? }            # observe's SyncReport
+  timing:
+    observe_ms, decide_ms, act_ms, after_ms
+    observe: { worktrees, base_fetch, local, sync.norn_refs, sync.elsewhere, sync.issues,
+               sync.stories, sync.elsewhere_prs, runner, stories }
+    calls:   { list_issues, get_issue, find_pr, pr_ci }
+    slowest: { phase: "observe.sync.stories", ms: 8400 }
 tick.end
+  slowest                              # the same, so `jq` on one line finds it
 heartbeat.json
+  last_tick_ms                         # → "heartbeat: last tick 3s ago on … (took 9.4s)" / "tick 3s ago · took 9.4s"
```

Every new field is optional, so older traces still validate. The phase timers sit on main's refactored observe (`syncRemote` and the bounded per-story pass). O4 in `.agents/RULES.md` now says what the record holds, and `docs/recipes.md` has a new section, "Explain a slow tick".

## Evidence

This `quick` round has no QA criteria report, so all the evidence here comes from tests. test#4 ran every tier on the current code and passed.

- **Observe broken down** (sync phases, call counts, local, stories, runner)
  **Before:** a tick recorded only its total `duration_ms`.
  **After:** `packages/cli/test/integration/tick-timing.test.ts` › "observe's phases are timed and the sync's remote calls counted as made". It runs a real `--sync` tick over the harness and asserts that `timing.observe` has `worktrees`, `local`, `sync.issues`, `sync.stories` and `stories`, and that `timing.calls` equals the calls FakeRemote saw (`list_issues: 1`).
  **Not covered:** the test does not assert the `base_fetch` and `sync.norn_refs` phases (a review nit), although they are timed the same way. Process liveness probes have no phase of their own: they count under `local` and `stories`, as the recipe says.
- **Decide timed**
  **Before:** not recorded.
  **After:** the same integration test asserts that `decide_ms` is an integer. The unit test `packages/cli/test/unit/tick-timing.test.ts` › "names the slowest of observe's phases, decide, each action and after" checks how the slowest phase is picked.
- **Each action's time in `result.ms`, `claim.renew` included**
  **Before:** only `run_check` recorded a time (in `detail.duration_ms`).
  **After:** integration › "each action's time is in its result, the claim renewal's included". The test moves the clock past the claim's renew time, then asserts that every decision has an integer `result.ms`, `claim.renew` included. Each renewal in a batch carries the batch's time, and `slowest` counts the whole batch once, as `act claim renew (N claims)` (unit test).
- **SyncReport in the tick record**
  **Before:** it appeared only in `norn tick`'s output.
  **After:** integration › "the tick record carries the sync report and validates": `assertValid` passes on the record and `sync` is present.
- **New fields optional, outside `facts`/`action`**
  **Before:** —
  **After:** `packages/schema/test/unit/records.test.ts` › "gh-78: a tick record carries its phase timings…" checks that records with and without the new fields both validate. The golden replay corpus is unchanged, so decide's inputs and outputs did not move.
- **The slowest phase is visible**
  **Before:** a slow tick's slowest phase could not be found.
  **After:** integration › "tick.end and `norn tick` name the slowest phase, the one the record names": `tick.end.slowest` and `norn tick`'s `slowest` both equal the record's `timing.slowest`.
- **The last tick's duration in status and the cockpit**
  **Before:** `heartbeat: last tick 3s ago on …`
  **After:** `heartbeat: last tick 3s ago on … (took 9.4s)` and `tick 3s ago · took 9.4s`. Integration › "the heartbeat carries the last tick's duration into `norn story list`" asserts that `last_tick_ms` equals the record's `duration_ms`. The test was checked by dropping `markTick`'s duration, and it went red. Two tests pin both text forms: `view.test.ts` › "gh-78: the heartbeat line…" and `cockpit-tui.test.ts` › "gh-78: the header shows…".

## Merge danger

**Door:** one-way, but mild. A revert removes all the code, but trace files written while this was merged keep the new fields. The old trace schemas use `additionalProperties: false`, so a reverted norn would reject those `tick` and `tick.end` records. To revert safely, remove the code and keep the optional schema fields. `heartbeat.json` causes no trouble: its schema allows extra fields, so an older norn still reads a file with `last_tick_ms`.

**Blast radius:** low: trace readers. `act_ms` includes writing the `tick.start` line, and per-story git and process probes share the `stories` phase. Both are documented. The timing itself costs a few `performance.now()` calls per tick, which is nothing measurable.
