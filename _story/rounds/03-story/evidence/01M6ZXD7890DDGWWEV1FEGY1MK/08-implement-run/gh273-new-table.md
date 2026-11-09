| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted (any level) | norn's milestone line goes into the handoff's existing Progress section at any heading level | test | `packages/cli/test/unit/report.test.ts` › "level 1/2/3/4 headings: the line lands after the last milestone of the one Progress section" (exact file content after `appendProgress`; levels 5–6 share the same `#{1,6}` path) |
| Wanted (no second section) | norn never creates a second Progress section when one exists | test | `packages/cli/test/unit/report.test.ts` › "level N headings: …", "a deeper heading inside Progress stays in the section; …", "an empty Progress section gets the line after one blank line", "Progress as the last section: …" (each asserts the whole file, so no `## Progress` is appended) |
| Repro | a handoff with `### Goal`, `### Progress`, `### Resume`, then `norn done done --handoff "x"`, must not end with a new `## Progress` | test | `packages/cli/test/unit/report.test.ts` › "level 3 headings: …" at `appendProgress`, the one function `done.ts:198`, `report.ts:86` and `checkout.ts:505` call with the line |

Not proven yet: none.
