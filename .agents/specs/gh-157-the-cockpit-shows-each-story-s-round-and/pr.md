## Summary

The cockpit now says which workflow each story is running: a story row shows the workflow before the step, the preview's status line reads like `norn story view` (round, workflow, then the step), and the filter (`/`) matches the workflow name.

```diff
 story row (storySummary)
-  ready sync · PR #9
+  quick · ready sync · PR #9

 preview status line (previewLines)
-  ✓ ready at sync · auto · held here
+  ✓ round 1 · quick · ready at sync · auto · held here   (no "round N ·" before the story starts)

 filter text (rowText)
-  group unit step title report-title
+  group unit step workflow title report-title
```

No view change: `OrientUnit` already carries `workflow` and `round` (gh-71 B28, D10).

## Evidence

No QA run in this round (quick workflow); the evidence is the unit tests in `packages/cli/test/unit/cockpit-tui.test.ts`, written first and seen red before the change. Unit tier (1064 pass) and the type check are green.

- **Preview status line reads like `story view`**
  **Before:** `│ ◐ running at implement · auto …`
  **After:** test asserts the preview of a round-2 `refinement` story matches `│ ◐ round 2 · refinement · running at implement · auto`, and a not-started `triage` story `│ · triage · not started · auto` (no round); a closed story reads `│ ✓ round 1 · quick · done · auto`.
- **A story row shows the workflow before the step**
  **Before:** `gh-5  Bump the parser  parked ci · PR #9`
  **After:** tests assert `quick · parked ci · PR #9`, `refinement · running implement`, `triage · not started` (Backlog) and `quick · done` (Done).
- **Filtering matches the workflow name**
  **Before:** typing a workflow name matched only rows whose title or step happened to contain it.
  **After:** test types `/refinement` and asserts `Rename the flag` (the `refinement` story) stays and `Bump the parser` (a `quick` story) is gone. The filter also keeps a NEEDS YOU item of a story running that workflow, since item rows carry their story's workflow (review nit; left as is).

Not shown: the live cockpit in Herdr. To check: open the cockpit and look at a story row and its preview.

## Merge danger

**Door:** two-way: display-only change in the cockpit TUI; a revert restores the old text exactly.

**Blast radius:** one screen: the cockpit rows get a few characters wider, so long titles truncate a little sooner on narrow panes; nothing reads this text as data.
