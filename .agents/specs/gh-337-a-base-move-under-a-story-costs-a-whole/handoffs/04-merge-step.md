### Goal
A step type `merge` after `ready` in story, quick (both copies) and release: an approved story waits there for its PR to merge, shows today's merge item, ends when the PR merges, and goes back to `update` by itself when the base moves under it in a way its workflow counts as stale.

### Proof
`bun run test` 1767 pass and `bun run typecheck` green at review #1; golden cases unchanged. Review #1 approved: no blocking findings.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a `type: merge` step validates with `stale` as its only outcome; any other outcome is refused with the reason | test | `packages/core/test/unit/base-sync.test.ts` › merge step › "a merge step validates with stale as its only outcome; any other outcome is refused with the reason" |
| AC2 | `ready` approving goes to the merge step in shipped story and quick (both copies) and release.yaml | test | `packages/cli/test/unit/assets.test.ts` › "story, quick and release approve at ready into a merge step that goes back to update when stale, in both copies"; `test/repo/repo.test.ts` › "release goes prepare → open-pr → ci → ready → merge, …" |
| AC3 | a story at the merge step shows exactly one item, today's merge item, and no gate item | test | base-sync › merge step › "the inbox shows exactly one item for a story at the merge step: today's merge item, never a gate item" |
| AC4 | the PR merging ends the story through today's merged-PR path; a PR closed unmerged behaves as today | test | base-sync › merge step › "the PR merging ends the story through today's merge path; a PR closed unmerged parks it as today" |
| AC5 | a stale base move sends the story to `update` through `stale_loop`; a squash-merged PR is never read as a base move; the counter max stops the loop | test | base-sync › merge step › "a stale base move sends a story at the merge step back to update through stale_loop, after a sync shows the PR" |
| AC6 | `norn approve` / `norn reject` at the merge step are refused | test | base-sync › merge step › "nothing at the merge step can be approved or rejected" (apply); S3 `packages/cli/test/integration/merge-step.test.ts` › "approve and reject at the merge step are refused; the story stays there" (exit 3, `not_at_gate`) |
| AC7 | a workflow with no merge step finishes the round at `ready`; a conflicting finished story shows the merge item with `norn story update-branch`; golden cases unchanged | test | base-sync › "4: waiting at ready, …", "5: gate without a stale route …", "6 (core): an update receipt re-enters update from $done, a gate or stuck …"; golden corpus unchanged |
| AC8 | `norn story update-branch` brings the base in for a story at the merge step (or stuck) | test | base-sync › merge step › "story update-branch brings the base in for a story waiting at the merge step"; base-sync › "6 (core) …" (stuck); S3 merge-step.test.ts › "story update-branch sends a story waiting at the merge step back through update" |
| AC9 | the merge step type is documented beside the other step types, and the base-sync recipe mentions it | agent | QA (agent): `docs/concepts.md` step table and glossary, `docs/recipes.md` base-sync recipe and writing a workflow, `docs/reference.md` regenerated |

Rule coverage: `merge.wait` and `unit.parked.merge` in `packages/core/test/rule-cases.ts`.

### Easy to miss
- A merge step parks with a new park kind `merge` (schema `ParkKind`/`ParkedKind`; json schemas re-emitted), not `gate`, so approve/reject, `nextCommand` and the Approve group never match it.
- Reachability counts a merge step as reaching `$done` (the merge ends the round), in core validation and the assets test helper.
- `readyApproval` counts a gate whose `approve` goes to a merge step as the ready gate (the head-changed Check item).
- The stale classify at a merge step reuses the rule ids `gate.stale` / `gate.stale.awaits_sync`.

### Not proven yet
- The S3 test `packages/cli/test/integration/merge-step.test.ts` was not run here: the integration tier runs only in CI.

### Notes
- Decision: `roundFinished` is unchanged. A story at a merge step is mid-round: it keeps its claim (so the tick can take `stale`), and `norn story edit --workflow` there needs `--force`. The refusal's do_instead names the forced command, and nothing is working, so it goes through. If people want an unforced new round from the merge step, treat a merge park as finished in story-edit's check and in decide's `roundStart`.
- At a merge step with no known PR, the inbox shows a your_turn item with the park reason and `norn story view --web`.
- The merge item's command still becomes `norn story update-branch` while the base conflicts; at a merge step that lasts only until the next tick takes `stale`.
- Review #1 minor note (not rework): user story 21 says a person can move the story off the merge step with the usual commands; today `norn story edit` needs `--force` there. This is for slice 06 (story edit refusal) or the person to settle.
- Out of scope, left to later slices: the open-pr guard for merge steps (05), re-verify at the merge step (11).

### Resume
Review #1 approved; next is the workflow's step after review. If CI's integration tier fails `merge-step.test.ts`, run `bun run test:integration packages/cli/test/integration/merge-step.test.ts` to reproduce it.
