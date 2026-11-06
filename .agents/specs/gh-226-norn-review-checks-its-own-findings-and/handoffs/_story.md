### Goal

`norn-review` verifies each blocking candidate before deciding, reads a repo-root `REVIEW.md`, pins every finding to a file and line with a counted summary; `norn init` writes a starter `REVIEW.md` when none exists.

### Progress

- Skill (`packages/cli/assets/skills/norn-review/SKILL.md`, copied to `.agents/skills/norn-review/` as #180 did; the unit test pins the copy to the source): step 2 reads `REVIEW.md` (ignore / what fails / what not to report, overrides the baseline, given to both axes); new step 4 verifies each blocking candidate in a fresh subagent (or by re-reading) and drops what does not hold or cites an ignored path (a red suite or `UNTRACED` row is re-checked, not dropped); `file`/`line` required; summary states the count or `No findings.`. No norn rule ids in the skill (P7).
- `norn init` (`packages/cli/src/commands/init.ts`) writes `packages/cli/assets/REVIEW.md` to the repo root only when absent; report field `review: exists|created`, a `review` row in the summary, and `REVIEW.md` in the commit hint.
- Docs: README init paragraph and console sample, concepts skills paragraph, RULES.md skills table row.
- Tests: `packages/cli/test/integration/init-review.test.ts` (created / kept), unit content test in `assets.test.ts` (gh-226), e2e slice-workflow commit-hint assertion updated. Unit, integration (875 pass), the e2e file, typecheck all green.
- Friction: changing a bundled skill means changing this repo's installed copy too (the test pins it), which may make the running norn see skill drift in this unit worktree (SK1) for later agent steps.

- review#1: changes requested (1 blocking, 1 minor). The unit tier is red since 88dc8b219 reverted `.agents/skills/norn-review/SKILL.md`: `packages/cli/test/unit/assets.test.ts:357` still pins the installed copy to the bundled source. Traceability:

| Item | Verifier | Proven by |
| --- | --- | --- |
| Verify pass before Decide, drop what does not hold | test | `packages/cli/test/unit/assets.test.ts` › "norn-review reads REVIEW.md, verifies each blocking candidate, and pins every finding to a file and line (gh-226)" |
| Reads repo-root `REVIEW.md` (ignore / failure / not to report) | test | same test |
| Every finding has file and line; summary states the count or `No findings.` | test | same test |
| `norn init` writes a starter `REVIEW.md` only when none exists | test | `packages/cli/test/integration/init-review.test.ts` › "a repo without one gets the starter, and init says so", "a repo's own REVIEW.md is kept as it is" |

### Resume

Fix F1 (drop or relax the installed-copy assertion at `packages/cli/test/unit/assets.test.ts:357`, keeping the copy unchanged as 88dc8b219 intended) and F2 (move `REVIEW_FILE` above the IGNORED doc comment in `packages/cli/src/commands/init.ts:28-32`); rerun `bun run test`.

## Progress

- implement#1 done: norn-review: REVIEW.md source, verify pass before Decide, file+line required, counted summary; norn init writes starter REVIEW.md when absent. Tests: init-review integration, assets unit content test; unit/integration/typecheck green.
- review#1 changes_requested: Unit tier red: 88dc8b219 reverted the installed norn-review copy but assets.test.ts:357 still pins it to the source (F1, blocking); misplaced IGNORED doc comment in init.ts (F2, minor). Spec items all implemented and traced.
