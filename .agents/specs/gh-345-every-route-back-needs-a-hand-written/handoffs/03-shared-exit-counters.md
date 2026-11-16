### Goal

A route leaving a shared file through a named exit is counted by one derived counter `<use step>.<exit>`, shared by every inner edge leaving through it, its default from the feeders' kind; mixed kinds are refused unless the use route writes `max:`.

### Proof

All in `packages/store/test/unit/derived-counters.test.ts` › "one counter per shared-file exit" (seam S1, through `loadWorkflowText` with shared texts), each red before the code:
- AC1 three check `fail` edges behind `broken` share `base-update.broken` max 5 › "three check fail edges leaving through one exit share the counter `<use step>.<exit>` at 5"
- AC2 reject-only → 2, stale-only → 10, `max: 3` on the use route → 3 › "an exit fed only by a gate's reject counts at 2, only by stale at 10; max: on the use route overrides it"; a non-deriving feeder stays uncounted, a use route to `$done`/`$stuck` derives nothing › "a feeder that derives nothing stays uncounted; …"
- AC3 conflict feeders: max 2, reset on every other outcome of every feeder step › "an exit fed by conflict edges counts at 2 and resets …"
- AC4 mixed check fail + gate reject refused at `/steps/<use>/outcomes/<exit>`, prefixed with the shared file, naming each kind with its edge; with `max: 4` both share it, no reset › "an exit fed by edges of different kinds is refused …"
- extra: `max:` on a use route to `$done` refused at that route › "max: on a use route to $done is refused at that route"
- AC5 `norn doctor --repo --json` reports the mixed exit prefixed with `shared/checked.yaml:` › `packages/cli/test/integration/derived-counters.test.ts` › "a shared exit fed by edges of different kinds, with no max: on its route, is reported prefixed with the shared file and naming the exit" (seam S4)
- `bun run test` and `bun run typecheck` green.

### Easy to miss

- The flattener copies the use route's `max:` onto every flat feeder edge; the derivation must treat those as one exit, never as per-edge `max:`, and every feeder's `max` must be stripped (it is, because with `max:` every feeder is counted).
- Agent feeders derive together, only when any one of them lies on a loop nothing else counts (decided after every lone edge and every non-agent feeder is counted).
- A use route naming `counter:` makes its feeders ordinary edges with that counter: no exit grouping.

### Not proven yet

- AC5's integration test was not run locally (the brief keeps the integration tier for CI); it type-checks and mirrors slice 02's doctor tests.

### Notes

- Code: `packages/core/src/derive-counters.ts` (`deriveEdgeCounters(doc, exits)`, `countExit`, new exported `ExitLeft`); `packages/store/src/derived-counters.ts` and `config.ts` pass the flattener's `exits` through. A core error may carry `step`, an included step whose shared file prefixes the message (the mixed refusal's pointer is the use route, which is no included step).
- Decision: with `max:` on a use route, every feeder (deriving or not) shares the counter; the reset of a single-kind conflict exit is kept, a mixed exit gets none. D5 reads "with max: they share it"; counting the non-deriving feeders too keeps `max` out of the pinned text and matches "max: on a use route with no deriving feeder counts every feeder".
- Shipped workflows are untouched (slice 05); their use routes all name counters today, so their counting is unchanged.

### Resume

Slice done; next is review of gh-345/03.
