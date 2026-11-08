## Summary

`norn-review` now applies a security checklist when a diff touches a path the repo's `REVIEW.md` marks sensitive, and this repo's `REVIEW.md` lists its sensitive paths. Breaches are blocking bugs on the existing Standards axis; there is no new axis.

```diff
 norn-review
   3. gather the sources
      REVIEW.md: ignore / failure / do not report
+     Sensitive paths: diff touches a path REVIEW.md marks sensitive?
+       Standards axis also applies SECURITY.md to those hunks
   4. Standards subagent prompt
      (a) documented standards (b) bugs (c) smells
+     (d) security checklist breaches in sensitive hunks, as bugs
```

`SECURITY.md` sits beside `SMELLS.md` and is loaded only on a sensitive diff. It covers injection, secrets, process spawning, env loading, the PATH shim, tokens, CI workflows and persisted data.

## Evidence

No QA ran. Both points are skill and docs text, so the review checked them by reading the files; no test covers them. `bun run test` and `bun run typecheck` are green on this head.

- **norn-review gains a security checklist for sensitive paths**
  **Before:** did not exist. `REVIEW.md` named one-way doors, but nothing gave those diffs a closer look.
  **After:** `packages/cli/assets/skills/norn-review/SECURITY.md`, wired into `SKILL.md` step 3 (Sensitive paths) and step 4 (Standards gets `SECURITY.md`, prompt item (d)). The skill folder installs whole, as `test/e2e/slice-workflow.test.ts` › init shows for `SMELLS.md`.
- **This repo's REVIEW.md lists its sensitive paths**
  **Before:** no such section.
  **After:** `REVIEW.md` › `## Sensitive paths` names `.github/workflows/`, `scripts/`, `packages/schema/src/`, `packages/store/` and `packages/cli/src/runtime/shim.ts`; all five exist in the tree.

Not shown: whether a reviewer agent actually picks up `SECURITY.md` on a sensitive diff. To check, run `norn-review` on a branch that touches `packages/store/` and look for checklist findings. The review accepted one gap: the starter `REVIEW.md` that `norn init` writes has no `## Sensitive paths` section yet, left for a follow-up.

## Merge danger

**Door:** two-way: skill and docs text only, so a revert removes it completely.

**Blast radius:** reviews: an over-eager checklist could raise more blocking findings on sensitive diffs in repos using the shipped skill, costing extra rework rounds. Repos without `## Sensitive paths` are unaffected.
