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

- review#1 (approve): traceability

| Item | Verifier | Proven by |
| --- | --- | --- |
| Wanted 1: the way out of a run-out counter is the outcome's target with the counter reset | test | `packages/core/test/unit/handoff-inbox.test.ts` › "leads to the edge's target with the counter reset", "a reserved target reruns the step with the counter reset", inbox (O1) unblock row; `packages/view/test/unit/cockpit.test.ts` › cockpitModel (u keeps --step/--reset); `packages/cli/test/integration/run-rerun-cancel.test.ts` › "the way out is the edge's target with the counter reset; …" (status inbox command) |
| Wanted 2: a plain rerun warns it will end the same way | test | `packages/core/test/unit/handoff-inbox.test.ts` › "a rerun that leaves the counter at its max warns …"; `run-rerun-cancel.test.ts` › same test (warning field) |
| Park records counter/max/outcome/target (W4) | test | `packages/core/test/unit/apply.test.ts` › transitions (W3, W4) exhausted case |
| Other stuck reasons keep the plain rerun | test | `handoff-inbox.test.ts` › "nudges, retries and other stuck reasons keep the plain rerun" |
| Repro (review_loop max, two changes_requested, rerun) | test | `run-rerun-cancel.test.ts` › gh-212 describe (gate reject past `loop` max) |

- Review findings: none blocking; F1 minor: `docs/recipes.md:40` still says a counter at its max shows a plain `norn run rerun <unit>`.
- review#1 approve: Approve: ParkInfo.counter recorded on an exhausted counted edge; inbox/nextCommand/cockpit u offer run rerun --step <to> --reset <counter>; run rerun warns when the counter stays at max. All Wanted items traced to tests; checks green. One minor: docs/recipes.md:40 still shows the plain rerun for a counter at its max.

## Resume

Review approved; next is the workflow's following step. Optional: update `docs/recipes.md:40` for the new way out (F1, minor).
