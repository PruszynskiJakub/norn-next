## Summary

`norn-review` now applies a security checklist when a diff touches a path the repo's `REVIEW.md` marks sensitive, and this repo's `REVIEW.md` lists its sensitive paths. Breaches are blocking bugs on the existing Standards axis; no new axis.

```diff
 norn-review
   2. gather sources
      REVIEW.md: ignore / failure / do not report
+     ## Sensitive paths touched by the diff?
+       Standards axis also applies SECURITY.md to those hunks
   3. Standards subagent prompt
      (a) documented standards (b) bugs (c) smells
+     (d) security checklist breaches in sensitive hunks, as bugs
```

`SECURITY.md` sits beside `SMELLS.md` and is loaded only on a sensitive diff. It covers injection, secrets, process spawning, env loading, the PATH shim, tokens, CI workflows and persisted data.

## Evidence

No QA ran. Both points are skill and docs text, so the review checked them by reading the files. No test covers them.

- **norn-review gains a security checklist for sensitive paths**
  **Before:** did not exist. `REVIEW.md` named one-way doors, but no part of the review gave those diffs a closer look.
  **After:** `packages/cli/assets/skills/norn-review/SECURITY.md`, wired into `SKILL.md` step 2 (Sensitive paths) and step 3 (the Standards prompt item (d)). The skill folder installs whole, as `test/e2e/slice-workflow.test.ts` › init shows for `SMELLS.md`.
- **This repo's REVIEW.md lists its sensitive paths**
  **Before:** no such section.
  **After:** `REVIEW.md` › `## Sensitive paths` names `.github/workflows/`, `scripts/`, `packages/schema/src/`, `packages/store/` and `packages/cli/src/runtime/shim.ts`. All five exist in the tree.

Not shown: whether a reviewer agent actually picks up `SECURITY.md` on a sensitive diff. To check, run `norn-review` on a branch that touches `packages/store/` and look for checklist findings. The review accepted one gap: the starter `REVIEW.md` that `norn init` writes has no `## Sensitive paths` section yet. That is left for a follow-up.

## Merge danger

**Door:** two-way: these are skill and docs text only, so a revert removes them completely.

**Blast radius:** reviews: if the checklist is over-eager, reviews of sensitive diffs in repos using the shipped skill may raise more blocking findings and cost extra rework rounds. Repos without `## Sensitive paths` are unaffected.
