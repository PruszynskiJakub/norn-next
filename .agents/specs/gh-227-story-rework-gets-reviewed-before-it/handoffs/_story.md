## Goal

Story-level rework in the `story` workflow is reviewed before it reaches the PR: `implement.done → review`, `approve → test`, `changes_requested → implement` counted by `review_loop`; a round without rework never runs review.

## Done means

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| Rework is reviewed | `implement.done → review`; review is `norn-review` with inputs `[spec, diff, last_findings]`; `approve → test`, `changes_requested → implement` counted by `review_loop` | test | `packages/cli/test/unit/assets.test.ts` › "story reviews its rework before the check, and a round without rework never reaches review" |
| A round without rework never runs review | `implement.done` is the only edge into review; update still goes straight to test | test | same test (`into("review")` and `targets("story", "update")`) |
| Both copies change together | `.agents/workflows/story.yaml` matches the shipped copy | test | `test/repo/repo.test.ts` › "the repo's copies of the shipped workflows have the same steps and edges" |
| Amend the `story` sketch in `.agents/RULES.md` | the issue's third Wanted item | — | not applicable: the file no longer exists in the repo |

- `packages/cli/test/unit/assets.test.ts` "story reviews its rework before the check, and a round without rework never reaches review": implement's only edge is to review, review is `norn-review` with inputs `[spec, diff, last_findings]`, its edges and counter, and `implement.done` is the only edge into review (update still goes straight to test).
- `test/repo/repo.test.ts` "the repo's copies of the shipped workflows have the same steps and edges": `.agents/workflows/story.yaml` matches the shipped copy.
- Core's `validateWorkflowDefinition` and `checkWorkflowLevel(…, "story")` report no issues on either copy (checked by hand with a scratch script).
- `bun run test` (1283 pass) and `bun run typecheck` green.

## Easy to miss

- Both copies change together; the repo copy keeps its own check command and implement instructions.
- The new cycle `implement → review → implement` needs its counter declared (`review_loop: { max: 3 }`, as in `quick`).

## Not proven yet

- Integration and e2e tiers: CI.

## Notes

- The issue also asks to amend the §11.1 `story` sketch in `.agents/RULES.md`; that file no longer exists in the repo (removed before this round), so there is nothing to amend.
- The workflow description is unchanged, so `docs:emit` has nothing to regenerate.
- Running story units keep their pinned workflow; the change reaches new rounds only.

## Resume

Review approved with no findings; the next step is the round's check (`test`).
