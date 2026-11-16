### Goal
An edge with no `counter:` gets a counter `<step>.<outcome>` at load, with its default max (and a conflict's reset). `max:` on the edge changes only the bound. Dotted names validate where they are stored.

### Proof
Review #2: every criterion is traced to a test that was read and seen to assert it. `bun run test` (2100 pass) and `bun run typecheck` are green. Review #1's dotted-name crash is fixed. Two blocking loader bugs remain (see Not proven yet).

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a check's fail and an exits-named outcome derive `<step>.<outcome>` max 5, no reset | test | `packages/store/test/unit/derived-counters.test.ts` › "a check's fail, and an outcome its exits map names, count at 5 with no reset; stale on a check counts at 10" |
| AC2 | gate reject max 2; conflict max 2 resetting on the step's other outcomes; stale max 10 on a check, a gate, a merge step | test | `packages/store/test/unit/derived-counters.test.ts` › "a gate's reject counts at 2, a conflict at 2 resetting on the step's other outcomes…" (+ stale on a check in AC1's test) |
| AC3 | an agent send-back on an uncounted loop gets max 3; forward edges and off-loop agent outcomes get none | test | `packages/store/test/unit/derived-counters.test.ts` › "an agent's send-back on a loop nothing else counts counts at 3…" (a send-back on a loop already counted is not in a fixture: minor) |
| AC4 | `max:` replaces only the max; on a non-deriving edge it counts that edge, no reset | test | `packages/store/test/unit/derived-counters.test.ts` › "max: on a deriving edge replaces only its max…" |
| AC5 | `max:` with `counter:` on one edge is refused at the edge | test | `packages/store/test/unit/derived-counters.test.ts` › "max: together with counter: on one edge is refused at that edge" |
| AC6 | `max:` on an edge to $done/$stuck is refused: no loop to bound | test | `packages/store/test/unit/derived-counters.test.ts` › "max: on an edge to $done or $stuck is refused…" |
| AC7 | named counters keep working: shared budget, custom reset_on, nothing derived | test | `packages/store/test/unit/derived-counters.test.ts` › "named counters work as today…" |
| AC8 | a dotted declared name, or an undeclared dotted `counter:`, is refused | test | `packages/store/test/unit/derived-counters.test.ts` › "a dotted name under counters, or on counter: with no such declared counter, is refused" |
| AC9 | a loop still uncounted after derivation is refused as `cycle without a counter` | test | `packages/store/test/unit/derived-counters.test.ts` › "a loop no edge counts even after derivation is refused as a cycle without a counter" |
| AC10 | a non-deriving workflow keeps its pin byte for byte; a deriving one pins the derived text | test | `packages/store/test/unit/derived-counters.test.ts` › "a workflow that derives nothing keeps its pinned text byte for byte…"; `packages/store/test/unit/shipped-workflow-counting.test.ts` › "each bundled/repo workflow as it was loads to the same source and hash" |
| AC11 | dotted names validate in state, the exhausted park, a reset list and the pinned workflow; as-written forms still refuse them | test | `packages/schema/test/unit/records.test.ts` › "validates in state.json's counters and the exhausted park", "validates in a receipt's reset list"; `packages/schema/test/unit/workflow.test.ts` › "the pinned workflow holds a dotted counter name…", "a workflow file as written refuses a dotted name under counters and on counter:" |
| AC12 | doctor passes a workflow with every default unwritten and reports each `max:` refusal with its edge | test | `packages/cli/test/integration/derived-counters.test.ts` (integration tier, CI only; its `defaults` fixture writes one `max: 3`: minor) |

### Easy to miss
- The derivation is `deriveEdgeCounters` in `packages/core/src/derive-counters.ts` (pure). The store writes it into the text in `packages/store/src/derived-counters.ts` (`withDerivedCounters`), called from `loadWorkflowText` after flattening and before parsing.
- `withDerivedCounters` runs on raw parsed YAML **before** the schema check. Any shape it assumes, rewrites or drops has to be either valid already or left for the schema to refuse. Both open bugs come from this.
- A derived pin cannot go through `loadWorkflowText` again (its dotted `counters:` keys are refused there). Pins are read with `parseWorkflowText`. Every reader of a workflow *file* goes through the loader (checked in review #2).
- `writtenEdges` skips step and outcome names that fail their patterns, so `edge.split(".")` only sees names without dots.

### Not proven yet
- **Blocking, a malformed `counters:` is dropped:** a deriving workflow with `counters: hello` (or `null`, or `[1]`) loads, and the bad value is silently replaced (`derived-counters.ts:46`). The same file with no deriving edge is refused `/counters must be object`. Repro and fix: findings file of review #2 (F1).
- **Blocking, wrong counting through a YAML alias:** two steps sharing an `outcomes:` map via `&o`/`*o` share the in-place write-back (`derived-counters.ts:38-44`). In the pin, `a.fail` names `counter: b.fail`. Repro and fix: findings file of review #2 (F2).
- AC12 runs only in CI.

### Notes
- Review #2 minor (not rework): AC3 has no fixture where an agent send-back sits on a loop another edge already counts. AC12's `defaults` fixture writes `reject: { to: implement, max: 3 }`. A use route's `max:` is refused at the inner shared step's pointer until slice 03 moves it to the exit. The agent row uses reachability rather than `elementaryCycles`, which is equivalent.
- Pre-existing, outside this diff: an outcome named `constructor` gives confusing `means`/`verdict` errors, because `withProse` reads through the prototype.
- Earlier fixture edits (old-wording-refusal, shared-workflows, housekeeping) only keep each test's case intact under derivation.

### Resume
Fix F1 and F2 in `packages/store/src/derived-counters.ts`:
- F1: return `source: null` when `doc.counters` is present but not a map, so the schema refuses it.
- F2: `structuredClone` the doc before the write-back, or rebuild each `outcomes` map.

Add a test for each in `packages/store/test/unit/derived-counters.test.ts`, then run `bun run test` and `bun run typecheck`.
