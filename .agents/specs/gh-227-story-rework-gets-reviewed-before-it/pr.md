## Summary

In the `story` workflow, story-level rework (from `test.fail`, `qa.fail`, `human-qa.reject`, `ci.fail`, `ready.reject`) is now reviewed before it is checked again and reaches the PR. Slices are already reviewed before they integrate, so a round without rework never runs the new step.

```diff
 implement
-  done → test
+  done → review
+review (norn-review, inputs [spec, diff, last_findings])
+  approve           → test
+  changes_requested → implement   (counter review_loop, max 3)
 update
   done → test                       (unchanged: no review without rework)
```

Same change in both copies: `packages/cli/assets/workflows/story.yaml` and `.agents/workflows/story.yaml`.

## Evidence

No QA ran; the entries are tests (unit tier and type check green in the `test` check).

- **Rework goes through review before the check**
  **Before:** `implement.done → test`, no review.
  **After:** `assets.test.ts` › "story reviews its rework before the check, and a round without rework never reaches review" asserts `implement → {done: review}`, review is `norn-review` with `[spec, diff, last_findings]`, `review → {approve: test, changes_requested: implement}` counted by `review_loop`. Fails against main's `story.yaml`, passes now.
- **A round without rework never runs review**
  **Before:** no review step.
  **After:** same test asserts the only edge into review is `implement.done`, and `update.done` still goes to `test`.
- **Both copies change together**
  **Before:** —
  **After:** `repo.test.ts` › "the repo's copies of the shipped workflows have the same steps and edges" passes with both copies changed.
- **Amend the `story` sketch in `.agents/RULES.md`**: not done; that file no longer exists in the repo.

## Merge danger

**Door:** two-way: a revert restores the old edges; running story units keep their pinned workflow, so only new rounds pick this up.

**Blast radius:** story rework rounds: each rework adds one agent review, and a review that keeps requesting changes parks the unit after three loops (`review_loop`).
