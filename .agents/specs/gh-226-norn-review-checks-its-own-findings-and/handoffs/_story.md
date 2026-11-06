### Goal

`norn-review` verifies each blocking candidate before deciding, reads a repo-root `REVIEW.md`, pins every finding to a file and line with a counted summary; `norn init` writes a starter `REVIEW.md` when none exists.

### Progress

- Skill (`packages/cli/assets/skills/norn-review/SKILL.md`, copied to `.agents/skills/norn-review/` as #180 did; the unit test pins the copy to the source): step 2 reads `REVIEW.md` (ignore / what fails / what not to report, overrides the baseline, given to both axes); new step 4 verifies each blocking candidate in a fresh subagent (or by re-reading) and drops what does not hold or cites an ignored path (a red suite or `UNTRACED` row is re-checked, not dropped); `file`/`line` required; summary states the count or `No findings.`. No norn rule ids in the skill (P7).
- `norn init` (`packages/cli/src/commands/init.ts`) writes `packages/cli/assets/REVIEW.md` to the repo root only when absent; report field `review: exists|created`, a `review` row in the summary, and `REVIEW.md` in the commit hint.
- Docs: README init paragraph and console sample, concepts skills paragraph, RULES.md skills table row.
- Tests: `packages/cli/test/integration/init-review.test.ts` (created / kept), unit content test in `assets.test.ts` (gh-226), e2e slice-workflow commit-hint assertion updated. Unit, integration (875 pass), the e2e file, typecheck all green.
- Friction: changing a bundled skill means changing this repo's installed copy too (the test pins it), which may make the running norn see skill drift in this unit worktree (SK1) for later agent steps.

### Resume

Nothing left for implement; next is the workflow's review/test.
