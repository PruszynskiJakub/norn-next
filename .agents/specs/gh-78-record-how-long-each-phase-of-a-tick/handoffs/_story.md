## Goal

Every tick record says where the tick spent its time (observe and its phases, decide, each action, after act), carries the sync report, and the last tick's duration shows in `norn story list` and the cockpit header.

## Progress

- Schema (`packages/schema/src/trace.ts`): optional `TickTrace.sync` (`TickSync`), `TickTrace.timing` (`TickTiming`: `observe_ms`, `decide_ms`, `act_ms`, `after_ms`, `observe` phases, `calls`, `slowest`), `TickUnitRecord.result.ms`, `TickEndTrace.slowest`. All optional, so older traces validate. `heartbeat.json` gets `last_tick_ms`. JSON schemas re-emitted.
- `packages/cli/src/runtime/timing.ts`: `PhaseTimer` (time/add/count) and `tickTiming` (rounds, picks the slowest of `observe.<phase>`, the rest of observe (`observe`), `decide`, `act <kind> <unit>`, `after`).
- observe times `worktrees`, `base_fetch`, `local`, `sync.norn_refs`, `sync.elsewhere`, `sync.issues`, `sync.stories`, `sync.elsewhere_prs`, `runner`, `stories`, and counts `list_issues`, `get_issue`, `find_pr`, `pr_ci`. Act times each action (a batched claim renewal gets the batch's time). runTick puts it all in the record outside `facts`/`action` (O5 replay untouched), `slowest` on `tick.end` and in `norn tick`'s output, and `markTick` records `last_tick_ms`.
- Display decision (the triage's open question, settled small since this is a `quick` round): the slowest phase is on the `tick.end` line (one `jq` away, recipe "Explain a slow tick" in `docs/recipes.md`) and in `norn tick` output; the heartbeat line of `norn story list` says `(took 9.4s)`, the cockpit header `tick 3s ago · took 9.4s`. No new command or `--why` change.
- O4 in `.agents/RULES.md` amended to say what the record now holds.
- Tests: `packages/cli/test/unit/tick-timing.test.ts`, schema records test, view formatter test, cockpit header test. Smoked with the dev build in a throwaway repo: the record has `sync`/`timing`, `tick.end` has `slowest`, `story list` shows the duration.
- Note: `act_ms` includes writing `tick.start` and building the Actor.
- implement#1 done: Tick records now carry sync report + timing (observe phases with remote call counts, decide, act, after, slowest); each decision result has ms; tick.end names the slowest phase; story list and cockpit header show the last tick's duration. Optional fields, outside facts/actions (O4 amended, O5 untouched). Unit tests + dev-build smoke; unit tier and typecheck green.

- review#1 (changes_requested): the scope and the design are right; test#1 passed. Blocking F1: no test runs a tick and checks the timing it records (observe phases and call counts, Actor ms, record sync/timing, tick.end slowest, heartbeat last_tick_ms → view). Minor F2: a batched renewal's time is counted again for each claim in slowest/result.ms. Minor F3: there is no separate 'process' phase. Nit F4: act_ms includes the tick.start write.

| Item | Verifier | Proven by |
| --- | --- | --- |
| W1 observe broken down (sync phases, call counts, local, stories, runner) | test | UNTRACED (only `tick-timing.test.ts` › "PhaseTimer adds up the time of each phase and counts calls"; observe's wiring is untested) |
| W2 decide timed | test | partial: `tick-timing.test.ts` › "tickTiming names the slowest…" (fed input; runTick untested) |
| W3 each action's time in result.ms, incl. claim.renew | test | partial: `tick-timing.test.ts` › "traceRecord records the sync report, each action's time…" (Actor's measuring untested) |
| W4 SyncReport in the tick record | test | `tick-timing.test.ts` › "traceRecord records the sync report…" |
| W5 new fields optional, outside facts/action | test | `packages/schema/test/unit/records.test.ts` › "gh-78: a tick record carries its phase timings…" |
| W6 slowest phase visible (tick.end) | test | partial: tickTiming test + schema test; the tick.end write is UNTRACED |
| W7 last tick's duration in status and the cockpit | test | `packages/view/test/unit/view.test.ts` › "gh-78: the heartbeat line…", `cockpit-tui.test.ts` › "gh-78: the header shows…"; markTick → lastTickMs → load is UNTRACED |
- review#1 changes_requested: Scope and design are right and every test tier passed. Blocking: no test runs a tick and checks the timing it records (observe phases and call counts, Actor ms, sync/timing in the record, tick.end slowest, heartbeat last_tick_ms in the view). Also minor: renewal batch time counted per claim, no separate process phase; nit: act_ms includes the tick.start write.

## Resume

Next (implement): add one cli integration test on createHarness (FakeRemote, one story) that runs a sync tick and checks the trace's tick record (sync, timing.observe phases, timing.calls, result.ms), tick.end.slowest and loadProjectView's heartbeat.last_tick_ms. Optionally address F2–F4 (see review findings).
