## Goal

Fix gh-273: `norn done` (and every other `appendProgress` caller) adds a second Progress section when the handoff's headings are not level 2. Regression test first, at `appendProgress`.

## Progress

- reproduce#1 reproduced: cause `packages/cli/src/runtime/report.ts` `appendProgress` matched `## Progress` and the section end `##` only; the brief shows the handoff demoted to `###`, and agents write it back that way. Full findings in the `## Reproduce` comment on #273.
- implement#1: regression test `packages/cli/test/unit/report.test.ts` (levels 1–4, a deeper subheading inside Progress, empty Progress, Progress last, no Progress) — red at levels 1, 3, 4 before the fix. Fix: find Progress at any level (`#{1,6}`), end it at the next heading as high or higher (as `dropSection` in core's brief does). A handoff with no Progress still gets a `## Progress` appended. One seam covers all three callers (`done`, gate rejections, checkout journaling). Unit tier and typecheck green.
- implement#1 done: appendProgress finds the Progress section at any heading level and ends it at the next heading as high; regression test packages/cli/test/unit/report.test.ts (levels 1-4 + edge cases), red before the fix; unit tier and typecheck green

- review#1: approve. Traceability:

  | Item | Verifier | Proven by |
  | --- | --- | --- |
  | Wanted: line goes into the existing Progress section at any heading level | test | `packages/cli/test/unit/report.test.ts` › "level {1,2,3,4} headings: the line lands after the last milestone of the one Progress section", "a deeper heading inside Progress stays in the section…", "an empty Progress section…", "Progress as the last section…" |
  | Wanted: never creates a second Progress section | test | `packages/cli/test/unit/report.test.ts` › same level 1–4 cases (exact file content); "a handoff without a Progress section gets one at the end" |

  One minor finding: the Progress match is case-sensitive (`dropSection` is not), so `### progress` would still get a second section.
- review#1 approve: appendProgress finds Progress at any heading level and ends it at the next heading as high; regression test covers levels 1-4 and edge cases, green. 1 minor finding (case-sensitive match), none blocking.

## Resume

Review approved; the next step is whatever the workflow runs after review.
