## Goal

Reproduce gh-273 (norn done adds a second Progress section when the handoff headings are level 3), confirm the cause and name the seam for a regression test. No fix.

## Progress

Reproduce findings (the same text as the issue comment; outputs indented):

**Reproduced** on `main` at 59a7b6a (0.25.0 + intake), through the CLI and with a minimal loop.

#### As a user (cli harness, real `norn brief` / `norn done` code path)

Throwaway test on `test/support/harness.ts` (one-step workflow, manual mode): tick until the unit is ready, `norn brief` in the worktree, write the handoff as `### Goal` / `### Progress` / `### Resume

The `## Reproduce` comment is on issue 273 (posted by the person). Next: the fix round, regression test at `appendProgress` first (see the seam above).
- reproduce#1 reproduced: Reproduced via the cli harness and a 0.1s appendProgress loop (levels 1,3,4 red, 2 green); cause report.ts:94 (and :99) match level-2 headings only; seam: unit test of appendProgress; Reproduce comment posted on #273
