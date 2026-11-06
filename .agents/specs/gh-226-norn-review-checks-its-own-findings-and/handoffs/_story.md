### Goal

`norn-review` verifies each blocking candidate before deciding, reads a repo-root `REVIEW.md`, pins every finding to a file and line with a counted summary; `norn init` writes a starter `REVIEW.md` when none exists.

### Progress

- Skill (`packages/cli/assets/skills/norn-review/SKILL.md`): step 2 reads `REVIEW.md` (ignore / what fails / what not to report, overrides the baseline, given to both axes); new step 4 verifies each blocking candidate in a fresh subagent (or by re-reading) and drops what does not hold or cites an ignored path (a red suite or `UNTRACED` row is re-checked, not dropped); `file`/`line` required; summary states the count or `No findings.`. No norn rule ids in the skill (P7). This repo's installed copy in `.agents/skills/` is left as released; the release skill refreshes it.
- `norn init` (`packages/cli/src/commands/init.ts`) writes `packages/cli/assets/REVIEW.md` to the repo root only when absent; report field `review: exists|created`, a `review` row in the summary, and `REVIEW.md` in the commit hint.
- Docs: README init paragraph and console sample, concepts skills paragraph, RULES.md skills table row.
- Tests: `packages/cli/test/integration/init-review.test.ts` (created / kept), unit content test in `assets.test.ts` (gh-226), e2e slice-workflow commit-hint assertion updated.
- review#1 changes_requested: unit tier red (assets.test.ts pinned the installed copy, F1), misplaced IGNORED doc comment in init.ts (F2, minor).
- implement#2 done: F1 fixed by dropping the installed-copy assertion; F2 fixed by moving `REVIEW_FILE` above the IGNORED doc comment. Unit tier 1263 pass, typecheck green; test#2 (unit, integration, typecheck) pass.
- review#2 approve: no blocking findings on HEAD. The handoff itself had grown to 1.38 MB (20 084 lines of the implement#2 note and Resume repeated, one stray character per copy) in 045c15f60; review#2 rewrote it from its last good version (ba57e077b) plus the notes above. Traceability:

| Item | Verifier | Proven by |
| --- | --- | --- |
| Verify pass before Decide, drop what does not hold | test | `packages/cli/test/unit/assets.test.ts` › "norn-review reads REVIEW.md, verifies each blocking candidate, and pins every finding to a file and line (gh-226)" |
| Reads repo-root `REVIEW.md` (ignore / failure / not to report) | test | same test |
| Every finding has file and line; summary states the count or `No findings.` | test | same test |
| `norn init` writes a starter `REVIEW.md` only when none exists | test | `packages/cli/test/integration/init-review.test.ts` › "a repo without one gets the starter, and init says so", "a repo's own REVIEW.md is kept as it is" |

- Friction: implement#2's handoff edit multiplied the file to 1.38 MB, and `norn brief` inlined all of it (1.3 MB brief). Worth an issue: the brief could cap or refuse an oversized handoff.

### Resume

Nothing left for review; the next step goes on from the approved change.

## Progress

- review#2 approve: Approve: all four gh-226 items implemented and traced; test#2 green. 1 minor (starter REVIEW.md lockfile globs). Rewrote the 1.38 MB corrupted handoff from its last good version.
