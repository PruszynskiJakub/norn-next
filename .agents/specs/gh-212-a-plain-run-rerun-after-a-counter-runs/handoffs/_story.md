## Goal

When a counter runs out (W4), the way out norn offers is the exhausted edge's target with the counter reset, and a plain `norn run rerun` that leaves the counter at its max warns it will end stuck the same way.

## Progress

- Decisions (the triage's open questions, settled for this quick round):
  - Where the counter and target come from: a new optional `ParkInfo.counter` `{name, max, outcome, to}` in state.json, set by `take()` in `packages/core/src/apply.ts` when a counted edge runs out. `reason` is unchanged and never parsed. Units that went stuck before this change have no field and keep the plain rerun.
  - Nudges, retries, agent `stuck` reports and other stuck reasons: unchanged (plain rerun). Only counted edges (all counters, `stale_loop`/`base_conflict_loop` included) get the new way out.
  - Way out: `unstickCommand` in `packages/core/src/commands.ts`: `norn run rerun <unit> --step <to> --reset <counter>`; `--reset` only when the target is `$done`/`$stuck`. Used by `nextCommand` (status, S9 header) and the inbox Unblock item; cockpit `u` now keeps the item command's flags (`packages/view/src/cockpit.ts`).
  - "Unchanged code" is not measured: a rerun that does not reset the counter keeps the edge closed, so the same outcome ends stuck again whatever the code. `run rerun` adds a `warning` field to its result (`rerunWarning` in core) whenever the counter is not in `--reset`; it never refuses.
- RULES.md: W4 says what the park records and the way out offered; the CK table's `u` row carries the flags. Schema JSON re-emitted.
- Tests: `apply.test.ts` (park.counter), `handoff-inbox.test.ts` (inbox command, nextCommand, rerunWarning), `cockpit.test.ts` (u argv), `run-rerun-cancel.test.ts` integration (gate rejected past `loop` max: status inbox command and the warning; 120s timeout, the flow takes ~30s).
- Unit tier, type check and the run-rerun integration file are green; golden corpus untouched.
- implement#1 done: Exhausted park records counter/max/outcome/target (ParkInfo.counter, W4); inbox, nextCommand and cockpit u offer run rerun --step <to> --reset <counter>; run rerun returns a warning when the counter is not reset. Unit, typecheck and run-rerun integration green.

## Resume

Nothing left for implement: report `done`.
