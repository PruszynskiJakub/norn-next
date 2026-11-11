# gh-337/06 — story edit points at update-branch for a conflicting PR

## Goal
Restarting the same workflow (no `--at`) on a finished story whose open PR conflicts with its base is refused with `update_branch_instead` naming `norn story update-branch gh-N`; a different workflow, `--at`, or no conflict still starts a round; AGENTS.md and the base recipe say so.

## Proof
Review #1 traceability (all rows read and seen to assert the item):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 (story 25) | same workflow, no `--at`, finished story with a conflicting open PR → exit 3, code `update_branch_instead`, `do_instead` `norn story update-branch gh-N`, no round starts | test | `packages/cli/test/integration/story-edit-update-branch.test.ts` › "the same workflow with no --at is refused (update_branch_instead) and no round starts" (asserts exit 3, code, do_instead, receipts unchanged) |
| AC2 (story 26) | a different workflow or `--at` still starts the round; no conflicting PR → same-workflow edit starts | test | same file › "a different workflow still starts the round", "the same workflow with --at still starts the round", "with no conflicting PR the same-workflow edit starts the round" |
| AC3 | AGENTS.md and the "The base moved under a story" recipe point at `norn story update-branch` and say a new round is for new work | agent | QA (agent) — `AGENTS.md` Process bullet and `docs/recipes.md` recipe read in review and say so |

- `bun run test` and `bun run typecheck` green (check test#1 pass).

## Easy to miss
- The refusal applies only inside `roundFinished(st)`; an unfinished round still takes the `round_unfinished` / `--force` path. `--force` on a finished round is the same edit as without it, so it is refused too.
- The PR is `pr ?? pr_seen` (fetched now, else last sync) and must be `open`; `merged_by_ancestry` skips the refusal. Conflict = `story.base.conflicts` non-empty from the local observation (merge-tree, cached per checkout).

## Not proven yet
- The integration test file runs in CI's integration tier (ran locally only that one file, green 3×).

## Notes
- Refusal lives in `packages/cli/src/commands/story-edit.ts` › `refuseUpdateBranchInstead`, called from the round `check`.
- Test scenario: three stories approved to `$done` with open PRs, then a sibling commit to main conflicts with gh-9 and gh-10 (a.txt) but not gh-11 (b.txt). The sibling clone uses `--no-local`: a plain local clone failed once copying objects ("failed to copy file") while the harness repo was in use.
- No command/flag text changed, so `docs:emit` not needed.

## Resume
Review #1 approved with no findings; next is QA of AC1–AC3 (AC3 by reading the two doc passages).
