# gh-345 — handoff

## Goal

Derived default counters for workflow edges (`<step>.<outcome>`, `<use step>.<exit>`, `max:` on the edge): the spec is refined, and the plan is agreed with the person and written to spec.md's Plan.

## Proof

- spec.md: 32 user stories. Stories 27 and 28 were corrected in the plan session (`approve-slices.reject`, `integrate.conflict`/`integrate.done`, `stale_loop` kept shared).
- spec.md › Plan: seams S1–S4, coverage for all 32 stories, one prefactor, decisions D1–D11, risks. Each seam and decision was agreed with the person.

## Easy to miss

- Derivation happens once, in the store's `loadWorkflowText`, before pinning (D1). The pinned workflow.yaml writes every counter out, and apply, brief, rerun and view don't change. A pin is never derived again.
- A file that derives nothing keeps its pin byte for byte (D2).
- Dotted names become valid in state.json, receipts **and the pinned workflow.yaml**: one-way, in the PR's merge danger.
- `stale_loop` stays a shared name wherever more than one edge shares it (shipped story, release, this repo's quick and story); `qa_loop` stays too.
- A shared exit's counter covers only the feeders that derive a counter; forward feeders stay uncounted (D5).
- Rows 1–4 of the defaults count an edge to a step even when it lies on no loop; only the agent row needs one (D4).
- Shipped workflow edits go into both `packages/cli/assets/workflows/` and `.agents/workflows/` (release only in `.agents/`).

## Not proven yet

- All of it: nothing is built. The invariant table (D9) must be taken from today's files before any workflow file is edited.

## Notes

Decisions by the person in the plan session:
- Derive at load into the pin, not on every read in core.
- Keep `stale_loop` shared where more than one edge shares it.
- Correct the step names in stories 27 and 28.
- An exit counter covers only feeders that derive; the mixed-kinds refusal applies only among those.
- Rows 1–4 follow the table as written, with no loop condition.

The prefactor: the flattener (store, shared-workflow) also hands back, per flat edge, the `<use>.<exit>` it left by and that route's counter/max.

## Resume

Next step: slice the Plan (prefactor first; the invariant table before any shipped-workflow edit).
