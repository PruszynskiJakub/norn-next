### Goal
No change outside the spec folder reaches a gate or the merge step that the round can end from without going back through `open-pr`. Then the PR head a person merges is always the commit `ci` watched pass.

### Proof
`bun run test` 1864 pass, `bun run typecheck` clean. Integration file `packages/cli/test/integration/open-pr-guard.test.ts` 3/3 pass when run alone (`bun run test:integration packages/cli/test/integration/open-pr-guard.test.ts`).

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a path from open-pr through an agent step or `git: update` to a gate or merge step, without open-pr again, is refused with the reason; the shipped workflows validate | test | `packages/core/test/unit/open-pr-guard.test.ts` › "an agent step between open-pr and a gate that lets the round end is refused with the path", › "a git: update between open-pr and the merge step is refused; a gate the round cannot end from is not", › "a workflow whose every change goes back through open-pr before ready or merge validates"; shipped workflows: `assets.test.ts` / `repo.test.ts` green (merge-bound reading, see Easy to miss) |
| AC2 | at a gate or merge step, a local head that changes a path outside the spec folder the PR lacks sends the story to open-pr with a receipt; spec-folder-only differences stay local and the story keeps waiting | test | core `open-pr-guard.test.ts` › "a change outside the spec folder that the PR head lacks sends the story back to open-pr with a receipt", › "spec-folder-only differences stay local and the story keeps waiting"; cli `packages/cli/test/integration/open-pr-guard.test.ts` › "AC2: a code change the PR lacks sends the story back through open-pr and ci…" (its detail lists only `fix.txt`, not the spec-folder `notes.md`). The cli "spec-folder-only change stays local" test runs no tick after its commit (review F1) |
| AC3 | passes ci, approved at ready, waits at merge: the PR head on the remote is the commit ci watched; no branch push after ci passed or ready approved | test | cli `open-pr-guard.test.ts` › "AC3: after ci passes and ready approves…": covers arrival at merge, but runs no tick while the story waits at merge (review F1) |

New rule ids `open_pr.guard` and `open_pr.guard.awaits_sync` have hand-built cases in `packages/core/test/rule-cases.ts`.

### Easy to miss
- **Reading of AC1 (decision).** Read literally, the static rule refuses the shipped story workflow: open-pr → ci.fail → implement → review → test → qa → human-qa (a gate). AC1 also says the shipped workflows validate. So the guard covers only the **merge-bound** steps (`mergeBoundSteps` in `packages/core/src/workflow.ts`): every merge step, and each gate with a path to a merge step or `$done` that avoids open-pr. In the shipped workflows that is `ready` and `merge`, not `human-qa` or `approve-slices`. The runtime guard uses the same set, so human-qa never bounces to open-pr. This follows the slice Goal ("so the head a person merges is the commit ci watched").
- The runtime move is a norn classify receipt, outcome `unpushed` (added to `CLASSIFIED_OUTCOMES` for gate and merge), with detail `changes since open-pr are not on the PR: <paths>` and route = the workflow's first open-pr step. apply's `backToOpenPr` enters open-pr directly: no edge and no counter. It cannot loop, because open-pr makes the PR head the local head.
- Like `gate.stale`, the guard acts only on a PR fetched this tick. Between syncs it waits (`open_pr.guard.awaits_sync`). It runs after the stale check and before the carried approval.
- Observe (`prUnpushed`, `packages/cli/src/runtime/observe/remote.ts`) fills `pr_unpushed` only when the known open PR's head is an ancestor of the local branch head. A diverged PR head (a person's push) is left to the existing head-changed item.

### Not proven yet
- Review F1 (blocking): `until(() => true)` in the cli integration test runs zero ticks, so the AC2 spec-folder-only test and AC3's waiting at merge are never observed over ticks. Fix: tick for real (lines 217, 227), then check the AC2 test goes red without the spec-folder filter.
- The rest of the integration tier and the e2e tier run in CI. Only open-pr-guard.test.ts ran here.

### Notes
- `docs/recipes.md` (writing a workflow) has a paragraph on the rule and the runtime return to open-pr.
- The property-test generator (`properties.test.ts`) now draws again when a random workflow fails only on `open_pr_bypass`.
- Friction: AC3 and the observe half of AC2 can only be observed at the integration tier, but the brief says not to run that tier, so this one file was run alone.

### Resume
Fix review F1 in `packages/cli/test/integration/open-pr-guard.test.ts`: replace `until(() => true)` loops with real ticks, prove the spec-folder test red by dropping the filter in `unpushedCode` temporarily, re-run the file alone. Findings: review#1 findings file in this run's receipts.
