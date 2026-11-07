## Goal

CI's process check refuses a PR that edits the installed skill copies `.agents/skills/norn*` outside a release, and the unit's skills-drift inbox hint names both causes: a stale base or this branch's own edit.

## Done means

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Wanted: process check | a story or bypass PR touching `.agents/skills/norn*` is refused unless titled `Release X.Y.Z`, and told to edit `packages/cli/assets/skills/` | test | `test/repo/process-check.test.ts` › "installed bundled skill copies" (story refused with source hint; bypass refused; release via story branch or bypass passes; repo-local skills and look-alikes pass; a title that only mentions a release is refused) |
| Wanted: process check sees every file | changed files come from every page, renames by both names | test | `test/repo/process-check.test.ts` › "reads every page of the PR's changed files, renames by both names" |
| Wanted: drift hint | `skillsDriftHint.unit` names both causes: merge the base in, or revert this branch's edit | test | `packages/core/test/unit/skills-drift.test.ts` › "drifted skills in the inbox"; same text pinned in `packages/cli/test/integration/skills-drift-hold.test.ts` and `test/e2e/base-sync.test.ts` |
| Local loop | `bun run test` and `bun run typecheck` green | test | review run: 1288 pass, 0 fail; tsc clean |

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
