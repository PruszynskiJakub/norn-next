### Goal

Triage gh-303: norn-qa, norn-triage and norn-diagnose should use subagents where they pay off, and each needs a fallback for when subagents can't be started.

### Proof

- The `## Triage` comment is posted: https://github.com/PruszynskiJakub/norn-next/issues/303#issuecomment-6739038152
- These labels are on the issue: norn:kind:feature, norn:risk:low, norn:priority:medium (the intake label `norn` is kept).

### Easy to miss

- None of the three skills has a "do it yourself" fallback today, even though the issue speaks of "the existing fallback". The fix has to add it, worded the way norn-review words it.
- The brief already gives subagents the rules they could break (`packages/core/src/brief.ts:769`, from #304). The skills should point to it, not repeat it.
- QA subagents share one prepared environment, so only criteria that don't change shared state should run in parallel.

### Not proven yet

- Nothing was run: the change is skill text only, so the triage is from reading the code.

### Notes

- Recommendation: quick. The pattern to copy is in `packages/cli/assets/skills/norn-review/SKILL.md:22,25-28,30`.
- Edit the skills in `packages/cli/assets/skills/` and refresh the `.agents/skills/` copies.

### Resume

A person picks the next round (quick, as recommended).
