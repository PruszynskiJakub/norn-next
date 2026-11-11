### Goal
A step type `merge` after `ready` in story, quick (both copies) and release: an approved story waits there for its PR to merge, shows today's merge item, ends when the PR merges, and goes back to `update` by itself when the base moves under it in a way its workflow counts as stale.

### Proof
All tests below are in the unit tier (`bun run test` 1767 pass) unless marked S3; `bun run typecheck` is green; the golden cases did not change (no `golden --update`).
- AC1 merge type validates, only `stale`, any other outcome refused with the reason: `packages/core/test/unit/base-sync.test.ts` › merge step › "a merge step validates with stale as its only outcome…"
- AC2 ready.approve → merge in shipped story/quick (both copies) and release: `packages/cli/test/unit/assets.test.ts` › "story, quick and release approve at ready into a merge step…"; `test/repo/repo.test.ts` › "release goes prepare → open-pr → ci → ready → merge…"
- AC3 one merge item, no gate item: base-sync › merge step › "the inbox shows exactly one item…"
- AC4 merged PR ends the story through `remote.pr_merged`; closed PR parks `remote: PR closed unmerged`: base-sync › merge step › "the PR merging ends the story…"
- AC5 stale → update via `stale_loop`, `gate.stale.awaits_sync` between syncs, the max stops it: base-sync › merge step › "a stale base move sends a story at the merge step back to update…"
- AC6 approve/reject refused: base-sync › merge step › "nothing at the merge step can be approved or rejected" (apply); S3 `packages/cli/test/integration/merge-step.test.ts` (cli, exit 3, `not_at_gate`)
- AC7 no merge step unchanged: existing base-sync cases 4–6 and the golden corpus pass unchanged
- AC8 update-branch at a merge step: base-sync › merge step › "story update-branch brings the base in…" (apply); S3 merge-step.test.ts › "story update-branch sends a story waiting at the merge step back through update"
- AC9 docs: `docs/concepts.md` (step kinds table, glossary, who does what), `docs/recipes.md` (base-sync recipe, writing a workflow); `docs/reference.md` regenerated
- Rule coverage: `merge.wait` and `unit.parked.merge` in `packages/core/test/rule-cases.ts`

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
- Out of scope, left to later slices: the open-pr guard for merge steps (05), re-verify at the merge step (11).

### Resume
Done. Next is the review step. If CI's integration tier fails `merge-step.test.ts`, run `bun run test:integration packages/cli/test/integration/merge-step.test.ts` to reproduce it.
