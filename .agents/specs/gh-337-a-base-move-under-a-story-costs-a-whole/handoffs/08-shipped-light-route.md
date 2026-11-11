## Goal
The shipped story and quick workflows (both copies) route the light path: update → (resolve) → test → resolution review → open-pr → ci → ready, so a base update costs one test run, at most one short review of the resolution, and one CI run.

## Proof
`bun run test` (1823 pass) and `bun run typecheck` are green; `schema:emit` and `docs:emit` leave no diff (re-run at review).

Traceability (review #1; each test read and seen to assert its row; the light-route tests run once per copy: shipped story/quick, repo story/quick):

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | shipped story and quick (both copies): update routes done → test, clean → merge test (pass → open-pr), resolved → resolution test (pass → resolution review), both tests fail → implement; the test command is written once; both copies validate | test | `packages/cli/test/unit/light-route.test.ts` › "it validates, and git: update routes done → test, clean → test-merge, resolved → test-resolution", "the merge test passes to open-pr, the resolution test to the resolution review, and both fail to implement", "the test command is written once and every test step runs it" |
| AC2 | the `resolution` input lists one `git show --remerge-diff <sha>` per merge commit since the last approval | test | `packages/core/test/unit/brief.test.ts` › "the resolution input …" › "lists one `git show --remerge-diff <sha>` per merge commit since the last approval, oldest first, a clean one included"; "no merge since the last approval: the input says none" |
| AC3 | after a clean update no resolution review runs: merge test, then open-pr | test | light-route.test.ts › "a clean update skips the resolution review: merge test, then open-pr" |
| AC4 | the resolution review's changes_requested goes back to resolve on counter resolution_loop, not to implement | test | light-route.test.ts › "blocking findings of the resolution review go back to resolve on resolution_loop, not to implement" |
| AC5 | approve goes to open-pr without describe; redescribe runs describe again before open-pr | test | light-route.test.ts › "approve goes to open-pr without describe; redescribe runs describe again first" (body kept: open-pr reads the unchanged pr.md, routing-level proof only) |
| AC6 | a YAML anchor for the test command parses to the same command in both test steps | test | light-route.test.ts › "the workflow loader resolves YAML anchors" › "an aliased test command parses to the same command in both steps"; per copy: "the test command is written once and every test step runs it" |
| (support) | a light-path update (clean or resolved) resets base_conflict_loop like done (`reset_on` takes a list) | test | `packages/core/test/unit/base-sync.test.ts` › "reset_on takes a list of edges: …"; light-route.test.ts › "a light-path update resets base_conflict_loop like a full one: …" |

## Easy to miss
- A light update ends `clean` or `resolved`, never `done`. A counter with `reset_on: update.done` would therefore never reset on the light path, and `base_conflict_loop` (max 2) would build up across base moves until the story went stuck. That is why `reset_on` now takes one edge or a list, and the shipped copies use `[update.done, update.clean, update.resolved]`.
- `resolution` reads the merges from the latest `classify` receipt that has a `history` (the git summary of the last routed update) and lists them oldest first. The recorded history itself is newest first.

## Not proven yet
- No end-to-end walk of the shipped route on real git (S3). The routing is proven at apply level (S1), the input at renderBrief (S2), and the gathering of the history by slice 07's e2e test.

## Notes
- Schema change beyond the slice text: `CounterSpec.reset_on` is now `string | string[]`, which `resetEdges()` in core reads. Validation reports a bad list entry at `/counters/<name>/reset_on/<i>`. Old single-string workflows and the golden cases are unchanged.
- `resolve`'s instructions gained one sentence for re-entry from the resolution review: fix the resolution the findings name and commit. Its findings show under Rework without a new input. A fix commit that is not a merge makes the next update `done`, so the story takes the full path. That is the safe direction; slice 09 or a later round may want the resolver to amend the merge instead.
- `redescribe` is a new outcome for `norn-review`, used only in this step. The brief's Finish list shows it with its `means` text; the skill text is unchanged.

## Resume
Review #1 approved with no blocking findings (two minor notes in its findings receipt). Nothing is open for this slice.
