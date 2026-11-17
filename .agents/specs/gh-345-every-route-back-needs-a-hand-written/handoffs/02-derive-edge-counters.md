### Goal
An edge with no `counter:` gets a counter `<step>.<outcome>` at load, with its default max (and a conflict's reset). `max:` on the edge changes only the bound. Dotted names validate where they are stored.

### Proof
Review #3 (approve): review #2's two blocking loader bugs are fixed, each behind a test in `packages/store/test/unit/derived-counters.test.ts` that was read: "a counters: that is not a map is refused as corrupt whether or not the workflow derives a counter" (derived-counters.ts:28) and "steps sharing one outcomes map through a YAML alias each count their own edge" (steps and outcomes copied, derived-counters.ts:42-49). Every criterion stays traced to a test that asserts it. `bun run test` (2102 pass, 0 fail) and `bun run typecheck` green on HEAD 7a9dc55.

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
- `withDerivedCounters` runs on raw parsed YAML **before** the schema check. Any shape it assumes, rewrites or drops has to be either valid already or left for the schema to refuse: a `counters:` that is no map derives nothing, so the schema refuses it. It copies each step and its outcomes before writing a counter in, because a YAML alias makes steps share one parsed object.
- A derived pin cannot go through `loadWorkflowText` again (its dotted `counters:` keys are refused there). Pins are read with `parseWorkflowText`. Every reader of a workflow *file* goes through the loader (checked in review #2).
- `writtenEdges` skips step and outcome names that fail their patterns, so `edge.split(".")` only sees names without dots.

### Not proven yet
- AC12 (doctor) runs only in the integration tier, in CI.

### Notes
- Review #2 minor (not rework): AC3 has no fixture where an agent send-back sits on a loop another edge already counts. AC12's `defaults` fixture writes `reject: { to: implement, max: 3 }`. A use route's `max:` is refused at the inner shared step's pointer until slice 03 moves it to the exit. The agent row uses reachability rather than `elementaryCycles`, which is equivalent.
- Pre-existing, outside this diff: an outcome named `constructor` gives confusing `means`/`verdict` errors, because `withProse` reads through the prototype.
- Earlier fixture edits (old-wording-refusal, shared-workflows, housekeeping) only keep each test's case intact under derivation.

### Resume
Review #3 approved: the slice integrates into the story branch; the next step is QA or integration, as the workflow says.
