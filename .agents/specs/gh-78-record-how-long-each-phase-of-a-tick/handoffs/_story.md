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

## Resume

Done; waiting for review. If review wants more, the seams are `tickTiming`/`PhaseTimer` (unit) and the tick record (cli integration harness).
