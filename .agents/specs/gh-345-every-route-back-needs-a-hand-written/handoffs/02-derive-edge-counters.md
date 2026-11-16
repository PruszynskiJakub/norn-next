### Goal
An edge with no `counter:` gets a counter `<step>.<outcome>` at load, with its default max (and a conflict's reset). `max:` on the edge changes only the bound. Dotted names validate where they are stored.

### Proof
- Default per kind: check fail / exits-named 5, gate reject 2, conflict 2 resetting on the step's other outcomes, stale 10, agent send-back on an uncounted loop 3. No counter on forward edges (AC1–AC3): `packages/store/test/unit/derived-counters.test.ts`, the first three tests.
- `max:` replaces only the max, and counts an edge that derives nothing (AC4): same file, "max: on a deriving edge replaces only its max…".
- `max:` with `counter:` refused (AC5), `max:` to `$done`/`$stuck` refused (AC6): same file, the two "is refused" tests.
- Named counters work as today (AC7). A dotted declared or undeclared `counter:` is refused (AC8): same file.
- A loop still uncounted is refused as `cycle without a counter` (AC9): same file, via `validateWorkflowDefinition`.
- A workflow that derives nothing keeps its pin byte for byte; a deriving one is pinned as derived text (AC10): same file, last test. Every shipped workflow keeps its pin: slice 01's `shipped-workflow-counting.test.ts` still passes.
- Dotted names validate in state counters, the exhausted park, the unstick receipt's reset list and the loaded workflow. The as-written `workflow-source`/`workflow-shared` still refuse them (AC11): `packages/schema/test/unit/records.test.ts` › "a counter derived from its edge…", `workflow.test.ts` › "counters derived from their edge, and max on an edge".
- Doctor passes all defaults and reports the two `max:` refusals with their edge (AC12): `packages/cli/test/integration/derived-counters.test.ts`. This is the integration tier, so it was **not run** here (the brief says CI runs it). Its three fixtures were checked through `loadWorkflowText` + `validateWorkflowDefinition` and give exactly the expected issues.
- `bun run test` (2099 pass) and `bun run typecheck` green. `bun run schema:emit` ran, and the emitted JSON is committed.

### Easy to miss
- The derivation is `deriveEdgeCounters` in `packages/core/src/derive-counters.ts`, which is pure. The store writes it into the text in `packages/store/src/derived-counters.ts` (`withDerivedCounters`), called from `loadWorkflowText` after flattening and before parsing.
- A derived pin cannot go through `loadWorkflowText` again, because its dotted `counters:` keys are refused there. Pins are read with `parseWorkflowText` (readPinnedWorkflow, record-ref, tick-trace), which is correct. The only other `loadWorkflowText` caller, `cli/src/runtime/checkout.ts`, reads a branch's workflow *file*.
- TypeBox `Record` keys are not pattern-checked without `additionalProperties: false`, so `state.counters` keys were never validated. The stored-name refusal is pinned on the reset list instead.
- The agent row uses reachability (u→v lies on a cycle of the uncounted edges iff v reaches u through them) rather than enumerating `elementaryCycles`. That is equivalent and simpler.
- Until slice 03, an included edge derives per edge. A use route's `max:` is copied onto each flat edge by the flattener's `leave()`.

### Not proven yet
- AC12 runs only in CI (integration tier).
- Integration and e2e fixtures with inline workflows that have an uncounted check fail, reject, conflict or stale edge now pin derived text (a new hash, plus counters in state). I fixed the two known "uncounted cycle" fixtures (`housekeeping.test.ts` LOOP, `shared-workflows.test.ts` loopy) to loop over `done` edges. Others may show up in CI.

### Notes
- Existing store tests whose fixtures now derive were changed: in `old-wording-refusal.test.ts`, the reject routes to `$stuck`, since that test is about wording. In `shared-workflows.test.ts`, the included `update.conflict` and the `like` copies now carry derived counters, and the exit-info test counts its conflict by name so its pin stays the flat text.
- An invalid `max:` (not an integer ≥ 1) is refused at `<edge>/max` by the derivation, so the schema never reports it as an unknown property.

### Resume
Review this slice. Next is slice 03 (one counter per shared exit, built on `exits` from the loader).
