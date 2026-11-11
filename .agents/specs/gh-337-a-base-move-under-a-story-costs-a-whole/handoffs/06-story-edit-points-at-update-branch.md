# gh-337/06 — story edit points at update-branch for a conflicting PR

## Goal
Restarting the same workflow (no `--at`) on a finished story whose open PR conflicts with its base is refused with `update_branch_instead` naming `norn story update-branch gh-N`; a different workflow, `--at`, or no conflict still starts a round; AGENTS.md and the base recipe say so.

## Proof
- AC1 (refused, exit 3, code `update_branch_instead`, do_instead `norn story update-branch gh-9`, no receipt written): `packages/cli/test/integration/story-edit-update-branch.test.ts` › "the same workflow with no --at is refused (update_branch_instead) and no round starts" — went red first (exit 0), green now.
- AC2 (round still starts): same file › "a different workflow still starts the round", "the same workflow with --at still starts the round", "with no conflicting PR the same-workflow edit starts the round".
- AC3 (docs): `AGENTS.md` (Process, "Only a person starts the next round") and `docs/recipes.md` › "The base moved under a story" now say a finished story with a conflicting PR is updated with `norn story update-branch` and a new round is for new work.
- `bun run test` (1757 pass) and `bun run typecheck` green.

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
Nothing left for implement; next step reviews the diff against the slice criteria.
