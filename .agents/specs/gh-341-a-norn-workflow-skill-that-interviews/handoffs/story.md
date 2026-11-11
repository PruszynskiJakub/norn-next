### Goal

Triage gh-341 (a bundled `norn-workflow` skill that interviews, drafts and validates a workflow): `## Triage` comment posted, labels set.

### Proof

- Triage comment: https://github.com/PruszynskiJakub/norn-next/issues/341#issuecomment-6808270301
- Labels added: norn:kind:feature, norn:risk:medium, norn:priority:medium

### Easy to miss

- `doctor --repo --json` reports schema errors first and semantic ones (unknown_skill, unknown_counter, …) only once the schema errors are fixed, so the skill has to re-run it until clean.
- `docs:emit` (`packages/cli/src/reference.ts`) emits no step-type reference today; item 3's generated reference is new work.
- A user's repo has no `docs/`, so the skill cannot point at docs/reference.md there.

### Not proven yet

- Design of the generated reference and the interview: for refinement.

### Notes

Recommendation: refinement.

### Resume

A person picks the next round (refinement recommended).
