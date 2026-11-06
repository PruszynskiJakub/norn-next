## Summary

Every tick record now says where the tick spent its time, so a slow tick can be explained from the trace. The record gets observe's phases with the sync's remote call counts, decide, each action, and the work after act. It also carries the sync outcome. `tick.end` and `norn tick` name the slowest phase, and `norn story list` and the cockpit header show how long the last tick took.

```diff
 tick record
   facts, decisions[].action            # unchanged: decide and --why replays read only these (O5)
+  decisions[].result.ms                # each action's time, claim.renew included
+  sync: { ran, ok, error? }            # observe's SyncReport
+  timing:
+    observe_ms, decide_ms, act_ms, after_ms
+    observe: { base_fetch, local, sync.norn_refs, sync.issues, sync.stories, runner, stories, … }
+    calls:   { list_issues, get_issue, find_pr, pr_ci }
+    slowest: { phase: "observe.sync.stories", ms: 8400 }
 tick.end
+  slowest                              # the same, so `jq` on one line finds it
 heartbeat.json
+  last_tick_ms                         # → "heartbeat: last tick 3s ago on … (took 9.4s)" / "tick 3s ago · took 9.4s"
```

Every new field is optional, so older traces still validate. O4 in `.agents/RULES.md` now says what the record holds, and `docs/recipes.md` has a new section, "Explain a slow tick".

## Evidence

No QA criteria report exists for this `quick` round. The evidence below is tests. test#2 ran every tier and passed on the approved HEAD.

- **Observe broken down** (sync phases, call counts, local, stories, runner)
  **Before:** a tick recorded only its total `duration_ms`.
  **After:** `packages/cli/test/integration/tick-timing.test.ts` › "observe's phases are timed and the sync's remote calls counted as made". It runs a real `--sync` tick over the harness and asserts `timing.observe` has the phases and `timing.calls` equals the calls FakeRemote saw (`list_issues: 1`). Process liveness probes have no phase of their own. They count under `local` and `stories`, as the recipe says.
- **Decide timed**
  **Before:** not recorded.
  **After:** the same integration test asserts `decide_ms` is an integer. The unit test `packages/cli/test/unit/tick-timing.test.ts` › "tickTiming names the slowest…" checks how the slowest phase is picked.
- **Each action's time in `result.ms`, `claim.renew` included**
  **Before:** only `run_check` recorded a time (in `detail.duration_ms`).
  **After:** integration › "each action's time is in its result, the claim renewal's included". The clock is moved past the claim's renew time, and the test asserts every decision, `claim.renew` included, has an integer `result.ms`. Renewals pushed in one batch each carry the batch's time, and `slowest` counts the batch once, as `act claim renew (N claims)` (unit test).
- **SyncReport in the tick record**
  **Before:** it was only in `norn tick`'s output.
  **After:** integration › "the tick record carries the sync report and validates": `assertValid` passes on the record, and `sync` is there.
- **New fields optional, outside `facts`/`action`**
  **Before:** —
  **After:** `packages/schema/test/unit/records.test.ts` › "gh-78: a tick record carries its phase timings…" checks that a record with and a record without the fields both validate. The golden replay corpus is unchanged.
- **The slowest phase is visible**
  **Before:** no way to see it.
  **After:** integration › "tick.end and `norn tick` name the slowest phase…": `tick.end.slowest` and `norn tick`'s `slowest` both equal the record's `timing.slowest`.
- **The last tick's duration in status and the cockpit**
  **Before:** `heartbeat: last tick 3s ago on …`
  **After:** `heartbeat: last tick 3s ago on … (took 9.4s)` and `tick 3s ago · took 9.4s`. Integration › "the heartbeat carries the last tick's duration into `norn story list`" asserts `last_tick_ms` equals the record's `duration_ms`. With `markTick`'s duration dropped, this test went red. The two text forms are pinned by `view.test.ts` › "gh-78: the heartbeat line…" and `cockpit-tui.test.ts` › "gh-78: the header shows…".

## Merge danger

**Door:** one-way, but mild. The code reverts cleanly. The trace format is the part that stays: trace records, `tick.end` lines and `heartbeat.json` written while this is merged keep the new fields, and the old schemas use `additionalProperties: false`, so a reverted norn would reject those files. To revert, drop the code and keep the optional schema fields.

**Blast radius:** low: trace readers. `act_ms` includes writing the `tick.start` line, and per-story git and process probes share one `stories` phase. Both are documented. Timing adds a few `performance.now()` calls per tick, nothing measurable.
