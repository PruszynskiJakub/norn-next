### Goal

A route leaving a shared file through a named exit is counted by one derived counter `<use step>.<exit>`, shared by every inner edge leaving through it, its default from the feeders' kind; mixed kinds are refused unless the use route writes `max:`.

### Proof

Traceability (review #1; seam S1 through `loadWorkflowText` with shared texts, seam S4 for doctor). Each test was read and seen to assert its item; `bun run test` (2108 pass) and `bun run typecheck` green at review.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | three check `fail` edges leaving through exit `broken` of `base-update` pin one counter `base-update.broken`, max 5 | test | `packages/store/test/unit/derived-counters.test.ts` › "three check fail edges leaving through one exit share the counter `<use step>.<exit>` at 5" |
| AC2 | a reject-only exit counts at 2, stale-only at 10, `max: 3` on the use route gives 3; a non-deriving feeder stays uncounted; a use route to `$done`/`$stuck` derives nothing | test | `packages/store/test/unit/derived-counters.test.ts` › "an exit fed only by a gate's reject counts at 2, only by stale at 10; max: on the use route overrides it" and "a feeder that derives nothing stays uncounted; a use route to $done or $stuck derives nothing" |
| AC3 | a conflict-fed exit counts at 2 and resets on every other outcome of every feeder step | test | `packages/store/test/unit/derived-counters.test.ts` › "an exit fed by conflict edges counts at 2 and resets on every other outcome of every feeder step" |
| AC4 | check fail + gate reject behind one exit, no `max:`, is refused at the use route naming the exit, its use step and each kind with its edge; with `max:` both share it, no reset | test | `packages/store/test/unit/derived-counters.test.ts` › "an exit fed by edges of different kinds is refused at the use route without max:, and shares max: with no reset when given" |
| AC5 | `norn doctor` reports the mixed-kind refusal prefixed with the shared file, naming the exit | test | `packages/cli/test/integration/derived-counters.test.ts` › "a shared exit fed by edges of different kinds, with no max: on its route, is reported prefixed with the shared file and naming the exit" (integration tier: runs in CI) |
| — | extra: `max:` on a use route to `$done` is refused at that route | test | `packages/store/test/unit/derived-counters.test.ts` › "max: on a use route to $done is refused at that route: there is no loop to bound" |

### Easy to miss

- The flattener copies the use route's `max:` onto every flat feeder edge; the derivation must treat those as one exit, never as per-edge `max:`, and every feeder's `max` must be stripped (it is, because with `max:` every feeder is counted).
- Agent feeders derive together, only when any one of them lies on a loop nothing else counts (decided after every lone edge and every non-agent feeder is counted).
- A use route naming `counter:` makes its feeders ordinary edges with that counter: no exit grouping.

### Not proven yet

- AC5's integration test was read, not run (the integration tier runs in CI only); CI must show it green.
- Agent feeders of a shared exit (derive together when one lies on an uncounted loop) have no test; review note, not blocking.

### Notes

- Code: `packages/core/src/derive-counters.ts` (`deriveEdgeCounters(doc, exits)`, `countExit`, new exported `ExitLeft`); `packages/store/src/derived-counters.ts` and `config.ts` pass the flattener's `exits` through. A core error may carry `step`, an included step whose shared file prefixes the message (the mixed refusal's pointer is the use route, which is no included step).
- Decision: with `max:` on a use route, every feeder (deriving or not) shares the counter; the reset of a single-kind conflict exit is kept, a mixed exit gets none. D5 reads "with max: they share it"; counting the non-deriving feeders too keeps `max` out of the pinned text and matches "max: on a use route with no deriving feeder counts every feeder".
- Shipped workflows are untouched (slice 05); their use routes all name counters today, so their counting is unchanged.

### Resume

Review approved with two minor notes (findings in the review receipt); next is integrating gh-345/03 into the story branch.
