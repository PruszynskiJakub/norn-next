## Goal

CI's process check refuses a PR that edits the installed skill copies `.agents/skills/norn*` outside a release, and the unit's skills-drift inbox hint names both causes: a stale base or this branch's own edit.

## Done means

- `scripts/process-check.ts` refuses a story or bypass PR whose changed files (renames by both names) include `.agents/skills/norn*` unless its title is `Release X.Y.Z`, telling the author to edit `packages/cli/assets/skills/` instead: `test/repo/process-check.test.ts` › "installed bundled skill copies" and the paginated-files gather test.
- `skillsDriftHint.unit` reads "…runs use this worktree's copies until the base is merged in, or until this branch's edit to them is reverted": `packages/core/test/unit/skills-drift.test.ts`; the integration and e2e pins carry the same text.
- `bun run test` and `bun run typecheck` green.

## Easy to miss

- The hint is shown in every repo that uses norn, so it does not name `packages/cli/assets/skills/` (only norn's own repo has that); the process-check message does, since it runs only here.
- Repo-local skills (`release`, `release-start`, `issue`) live in `.agents/skills/` too and stay editable; only `norn*` folders count.
- `gh pr view --json files` caps at 100 files, so the files come from `gh api --paginate --slurp repos/R/pulls/N/files`.

## Not proven yet

- The live check on GitHub (pull_request_target runs the base's script, so it takes effect only after this merges). Dry-run against history (read-only `gh`): release PRs #272, #243, #217 pass; story PR #270, which edited the copies, is now refused.

## Notes

- A release PR is told apart by title: every release PR, from the release workflow (`gh-N-release`) or a bypass (`bypass/release-X.Y.Z`), is titled `Release X.Y.Z`. Branch name and labels differ between the two paths; the title does not.
- Dependabot is exempt, as before; the copy rule runs after rules (a)/(b) pass.
- Docs: CONTRIBUTING.md, docs/development.md and the comment in `.github/workflows/process.yml` describe the new rule.

## Resume

Implement is done; next is whatever the quick workflow runs after implement (review / CI).
