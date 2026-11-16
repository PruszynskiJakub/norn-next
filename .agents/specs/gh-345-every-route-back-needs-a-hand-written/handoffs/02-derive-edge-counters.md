### Goal
An edge with no `counter:` gets a counter `<step>.<outcome>` at load, with its default max (and a conflict's reset). `max:` on the edge changes only the bound. Dotted names validate where they are stored.

### Proof
Review #1's blocking finding (a dotted step name crashed the loader) is fixed and tested. `bun run test` (2100 pass) and `bun run typecheck` are green.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a check's fail and an exits-named outcome derive `<step>.<outcome>` max 5, no reset | test | `packages/store/test/unit/derived-counters.test.ts` › "a check's fail, and an outcome its exits map names, count at 5…" |
| AC2 | gate reject max 2; conflict max 2 resetting on the step's other outcomes; stale max 10 on a check, a gate, a merge step | test | `packages/store/test/unit/derived-counters.test.ts` › "a check's fail…" (stale on a check) and "a gate's reject counts at 2, a conflict at 2…" |
| AC3 | an agent send-back on an uncounted loop gets max 3; forward edges and off-loop agent outcomes get none | test | `packages/store/test/unit/derived-counters.test.ts` › "an agent's send-back on a loop nothing else counts…" |
| AC4 | `max:` replaces only the max; on a non-deriving edge it counts that edge, no reset | test | `packages/store/test/unit/derived-counters.test.ts` › "max: on a deriving edge replaces only its max…" |
| AC5 | `max:` with `counter:` on one edge is refused at the edge | test | `packages/store/test/unit/derived-counters.test.ts` › "max: together with counter: on one edge is refused at that edge" |
| AC6 | `max:` on an edge to $done/$stuck is refused: no loop to bound | test | `packages/store/test/unit/derived-counters.test.ts` › "max: on an edge to $done or $stuck is refused…" |
| AC7 | named counters keep working: shared budget, custom reset_on, nothing derived | test | `packages/store/test/unit/derived-counters.test.ts` › "named counters work as today…" |
| AC8 | a dotted declared name, or an undeclared dotted `counter:`, is refused | test | `packages/store/test/unit/derived-counters.test.ts` › "a dotted name under counters, or on counter: with no such declared counter, is refused" |
| AC9 | a loop still uncounted after derivation is refused as `cycle without a counter` | test | `packages/store/test/unit/derived-counters.test.ts` › "a loop no edge counts even after derivation…" (through validateWorkflowDefinition, as doctor and the tick run it) |
| AC10 | a non-deriving workflow keeps its pin byte for byte; a deriving one pins the derived text | test | `packages/store/test/unit/derived-counters.test.ts` › "a workflow that derives nothing keeps its pinned text…"; `packages/store/test/unit/shipped-workflow-counting.test.ts` › "each … workflow as it was loads to the same source and hash" |
| AC11 | dotted names validate in state, the exhausted park, a reset list and the pinned workflow; as-written forms still refuse them | test | `packages/schema/test/unit/records.test.ts` › "a counter derived from its edge, named <step>.<outcome>"; `packages/schema/test/unit/workflow.test.ts` › "counters derived from their edge, and max on an edge" |
| F1 | a dotted step or outcome name in a file is refused as corrupt, never thrown | test | `packages/store/test/unit/derived-counters.test.ts` › "a dotted step or outcome name in a file is refused as corrupt, never thrown, and derives nothing" |
| AC12 | doctor passes a workflow with every default unwritten and reports each `max:` refusal with its edge | test | `packages/cli/test/integration/derived-counters.test.ts` (integration tier; not run locally, CI runs it) |

### Easy to miss
- The derivation is `deriveEdgeCounters` in `packages/core/src/derive-counters.ts`, which is pure. The store writes it into the text in `packages/store/src/derived-counters.ts` (`withDerivedCounters`), called from `loadWorkflowText` after flattening and before parsing.
- A derived pin cannot go through `loadWorkflowText` again, because its dotted `counters:` keys are refused there. Pins are read with `parseWorkflowText` (readPinnedWorkflow, record-ref, tick-trace), which is correct. The only other `loadWorkflowText` caller, `cli/src/runtime/checkout.ts`, reads a branch's workflow *file*.
- TypeBox `Record` keys are not pattern-checked without `additionalProperties: false`, so `state.counters` keys were never validated. The stored-name refusal is pinned on the reset list instead.
- The agent row uses reachability (u→v lies on a cycle of the uncounted edges iff v reaches u through them) rather than enumerating `elementaryCycles`. That is equivalent and simpler.
- Until slice 03, an included edge derives per edge. A use route's `max:` is copied onto each flat edge by the flattener's `leave()`.
- Edge keys `<step>.<outcome>` are built before the schema checks names. `writtenEdges` in core therefore skips any step or outcome whose name fails `STEP_NAME_PATTERN`/`OUTCOME_NAME_PATTERN` (and a conflict's reset list skips such siblings), so the store's `edge.split(".")` only ever sees names without dots, and the schema check refuses the file.

### Not proven yet
- AC12 runs only in CI (integration tier).
- Integration and e2e fixtures whose inline workflows have an uncounted check fail, reject, conflict or stale edge now pin derived text. Some may move in CI.

### Notes
- Existing store tests whose fixtures now derive were changed: in `old-wording-refusal.test.ts`, the reject routes to `$stuck`, since that test is about wording. In `shared-workflows.test.ts`, the included `update.conflict` and the `like` copies now carry derived counters, and the exit-info test counts its conflict by name so its pin stays the flat text.
- An invalid `max:` (not an integer ≥ 1) is refused at `<edge>/max` by the derivation, so the schema never reports it as an unknown property.
- Review #1: the agent row counts every agent send-back on a loop made only of agent edges (for example `fix.rethink` and `fixed.again` both count). The test pins this and the spec allows it.

### Resume
Nothing open in this slice: the next step is review of the fix for the dotted-name crash.
