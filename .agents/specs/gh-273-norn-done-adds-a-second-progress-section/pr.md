## Summary

`norn done` (and every other `appendProgress` caller: gate rejections, checkout journaling) now puts its milestone line into the handoff's existing Progress section at whatever heading level the agent wrote it, instead of adding a second `## Progress` after Resume when the handoff uses `###` headings.

```diff
 appendProgress(handoff, line)
-  find "## Progress"; section ends at the next "##"
+  find "Progress" at any heading level (#…######)
+  section ends at the next heading as high or higher (a deeper subheading stays inside)
   no Progress at all → append "## Progress" (unchanged)
```

## Evidence

No QA ran; the entries are unit tests in `packages/cli/test/unit/report.test.ts`, green in the test check.

- **W1** Line goes into the existing Progress section at any heading level
  **Before:** at levels 1, 3 and 4 the line landed in a new `## Progress` at the end of the file (these cases were red before the fix).
  **After:** "level {1,2,3,4} headings: the line lands after the last milestone of the one Progress section" asserts exact file content; also covered: a deeper heading inside Progress, an empty Progress, Progress as the last section.
- **W2** Never creates a second Progress section
  **Before:** a `### Progress` handoff ended with both `### Progress` and `## Progress`.
  **After:** the same level 1–4 cases assert the whole file, one Progress section; "a handoff without a Progress section gets one at the end" keeps the only case that adds one.

Accepted gap (review, minor): the match is case-sensitive, so a `### progress` heading would still get a second section.

## Merge danger

**Door:** two-way: a code-only change to how one handoff line is placed; a revert restores the old placement.

**Blast radius:** handoff files: if wrong, a milestone line lands in the wrong section of a unit's handoff, which only agents and people reading it notice.
