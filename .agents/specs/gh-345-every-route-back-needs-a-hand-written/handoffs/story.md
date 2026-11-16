#### Goal

Derived default counters for workflow edges (`<step>.<outcome>`, `<use step>.<exit>`, `max:` on the edge). The spec and Plan are agreed. The Plan is now cut into six slices that await the person's approval.

#### Proof

- spec.md: 32 user stories, Plan (seams S1–S4, decisions D1–D11). Its frontmatter `criteria` lists every slice criterion, prefixed `01.AC1` … `06.AC2`.
- slices/: six slice files. Every user story is cited by some slice's acceptance:
  1. `01` Shared-exit routes kept after flattening, plus the invariant table of today's shipped counting. Prefactor, no behaviour change. Depends on nothing.
  2. `02` Derive a counter per edge at load: defaults, `max:` on the edge, its refusals, dotted names valid where stored, doctor (a cli integration test over `norn doctor`). Depends on 01.
  3. `03` One derived counter per shared-file exit, and the mixed-kind refusal, with doctor reporting it (a cli integration test). Depends on 01 and 02.
  4. `04` Derived counters in the park, brief, status, story view and rerun, plus the `integrate.conflict` bound. Depends on 02.
  5. `05` Shipped workflows drop default counters, and the golden cases are updated, and `docs:emit` rewrites the emitted reference. Depends on 01 and 03.
  6. `06` Docs for derived counters. Depends on 05.
- Critical path: 01 → 02 → 03 → 05 → 06 (5 slices). Startable at once: 01 only. 04 runs beside 03 once 02 is in.

#### Easy to miss

- Derivation happens once, in the store's `loadWorkflowText`, before pinning (D1). A pin is never derived again. A file that derives nothing keeps its pin byte for byte (D2).
- Dotted names become valid in state.json, receipts **and the pinned workflow.yaml**. This is one-way and goes in the PR's merge danger.
- `stale_loop` stays shared wherever more than one edge shares it, and `qa_loop` stays too. A shared exit's counter covers only the feeders that derive a counter (D5). Rows 1–4 count an edge even when it lies on no loop (D4).
- The invariant table (slice 01) is taken from today's files before any workflow file is edited. Shipped workflow edits go into both `packages/cli/assets/workflows/` and `.agents/workflows/` (release only in `.agents/`).

#### Not proven yet

- All of it: nothing is built yet.

#### Notes

- I checked the Plan against this base, and it holds: `loadWorkflowText` and `flattenWorkflowText` in store, `elementaryCycles` and `validateWorkflowDefinition` in core, the dotless `CounterName` in schema. `reproduce` and `triage` declare no counters, so slice 05 leaves them alone.
- The schema change (dotted stored names, `max:` on an edge) is folded into slice 02, not cut as its own slice. This keeps the critical path at 3, and the change is small.
- Rework after approve-slices rejected round 1: 02 now depends on 01 (the Plan puts the invariant table first), doctor criteria 02.AC12 and 03.AC5 are cli integration tests (seam S4), not agent checks, and 05 runs `bun run docs:emit` while 06 depends on 05, so the docs and the emitted reference follow the rules as built.

#### Resume

Next step: the person approves the slices. Then slice 01 starts; the rest follow by their dependencies.
