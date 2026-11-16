# gh-342/01 — Pin today's meaning of every workflow the story rewrites

## Goal
Record what bundled `quick`/`story` and this repo's `quick`/`story`/`release` mean today (their `workflowHash`, through the store's loader), so a later rewrite into shared files goes red if it changes a route, counter or instruction.

## Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | bundled templates load through the store's loader; bundled `quick`/`story` equal their recorded `workflowHash`, with 29 routes / 8 counters and 42 routes / 10 counters | test | `packages/cli/test/unit/assets.test.ts` › workflow templates › "load through the store's loader without errors", "quick keeps its pinned meaning", "story keeps its pinned meaning", "quick has 29 routes and 8 counters, story 42 routes and 10 counters" |
| AC2 | this repo's workflows load through the store's loader; `quick`/`story`/`release` equal their recorded `workflowHash` | test | `test/repo/process.test.ts` › repo workflows › "load without errors", "quick/story/release keeps its pinned meaning" |

- AC1 (bundled templates load through the store's loader, quick/story equal their recorded `workflowHash`, 29 routes/8 counters and 42/10): `packages/cli/test/unit/assets.test.ts` › workflow templates › "load through the store's loader without errors", "quick keeps its pinned meaning", "story keeps its pinned meaning", "quick has 29 routes and 8 counters, story 42 routes and 10 counters". Every other template test there now reads the loader's output too (`loadWorkflow` helper).
- AC2 (repo workflows load through the store's loader, quick/story/release equal their recorded `workflowHash`): `test/repo/process.test.ts` › repo workflows › "quick/story/release keeps its pinned meaning" (the block already loaded through `loadWorkflows`).
- Red seen: bumping a counter max in `assets/workflows/quick.yaml` failed "quick keeps its pinned meaning"; bumping `ready_loop` in `.agents/workflows/release.yaml` failed "release keeps its pinned meaning" (both reverted).
- `bun run test` (1919 pass) and `bun run typecheck` green.

## Easy to miss
- The hashes are `workflowHash` (canonical JSON of the parsed workflow), not `state.json`'s `workflow_hash` (sha256 of file text): formatting and key order never change them. They were taken from the loader on this base, not by hand.
- The asset tests copy `assets/workflows/` into a temp root at `.agents/workflows/` because `loadWorkflows` reads only that layout; the copy is recursive so a future `shared/` folder comes along.

## Not proven yet
Nothing for this slice.

## Notes
- Route count = number of outcome keys summed over steps; counter count = keys of `counters`.
- Slices 05/06 must leave these hashes unchanged; a diff means the rewrite changed meaning.
- Review #1 (minor, for slice 06): three tests in `packages/cli/test/unit/assets.test.ts` (around lines 249, 281, 294) still `parse` this repo's `.agents/workflows/*.yaml` by hand; once slice 06 moves steps into shared files via `use:`, those raw reads miss them. Switch them to `loadWorkflows(ROOT)` when the repo set is rewritten.

## Resume
Review approved; next is integrate.
