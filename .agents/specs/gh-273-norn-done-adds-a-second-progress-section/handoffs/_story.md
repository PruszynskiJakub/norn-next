## Goal

Fix gh-273: `norn done` (and every other `appendProgress` caller) adds a second Progress section when the handoff's headings are not level 2. Regression test first, at `appendProgress`.

## Progress

- reproduce#1 reproduced: cause `packages/cli/src/runtime/report.ts` `appendProgress` matched `## Progress` and the section end `##` only; the brief shows the handoff demoted to `###`, and agents write it back that way. Full findings in the `## Reproduce` comment on #273.
- implement#1: regression test `packages/cli/test/unit/report.test.ts` (levels 1–4, a deeper subheading inside Progress, empty Progress, Progress last, no Progress) — red at levels 1, 3, 4 before the fix. Fix: find Progress at any level (`#{1,6}`), end it at the next heading as high or higher (as `dropSection` in core's brief does). A handoff with no Progress still gets a `## Progress` appended. One seam covers all three callers (`done`, gate rejections, checkout journaling). Unit tier and typecheck green.

## Resume

Nothing left in implement; the next step is the workflow's review/test.
