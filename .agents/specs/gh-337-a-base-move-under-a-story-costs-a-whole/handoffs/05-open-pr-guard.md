### Goal
No change outside the spec folder reaches a gate or the merge step that the round can end from without going back through `open-pr`. Then the PR head a person merges is always the commit `ci` watched pass.

### Proof
`bun run test` 1864 pass, `bun run typecheck` clean. Integration file `packages/cli/test/integration/open-pr-guard.test.ts` 3/3 pass when run alone (`bun run test:integration packages/cli/test/integration/open-pr-guard.test.ts`).

| Criterion | What it says | Verifier | Proven by (red first where marked) |
| --- | --- | --- | --- |
| AC1 | a path from open-pr through an agent step or `git: update` to a gate/merge step without open-pr again is refused with the reason; the shipped workflows validate | test | `packages/core/test/unit/open-pr-guard.test.ts` › "an agent step between open-pr and a gate that lets the round end is refused with the path" (red first), › "a git: update between open-pr and the merge step is refused; …" (red first), › "a workflow whose every change goes back through open-pr…validates"; shipped story/quick/release still validate (`assets.test.ts`, `repo.test.ts` unchanged and green) |
| AC2 | at a gate or merge step, a local head that changes a path outside the spec folder the PR lacks sends the story to open-pr with a receipt; spec-folder-only differences stay local | test | open-pr-guard.test.ts (core) › "a change outside the spec folder…sends the story back to open-pr with a receipt" (red first), › "spec-folder-only differences stay local…", › "a gate the round cannot end from…keeps waiting; between syncs the guard waits for one" (red first); S3 open-pr-guard.test.ts (cli) › "AC2: a spec-folder-only change stays local…", › "AC2: a code change the PR lacks sends the story back through open-pr and ci, with a receipt saying why" |
| AC3 | passes ci, approved at ready, waits at merge: the PR head on the remote is the commit ci watched; no branch push after ci passed or ready approved | test | S3 open-pr-guard.test.ts (cli) › "AC3: after ci passes and ready approves…" (the `ci` check records the remote branch tip it ran on; a post-receive hook logs pushes). This holds since slice 03; the test pins it. |

New rule ids `open_pr.guard` and `open_pr.guard.awaits_sync` have hand-built cases in `packages/core/test/rule-cases.ts`.

### Easy to miss
- **Reading of AC1 (decision).** Read literally, the static rule refuses the shipped story workflow: open-pr → ci.fail → implement → review → test → qa → human-qa (a gate). AC1 also says the shipped workflows validate. So the guard covers only the **merge-bound** steps (`mergeBoundSteps` in `packages/core/src/workflow.ts`): every merge step, and each gate with a path to a merge step or `$done` that avoids open-pr. In the shipped workflows that is `ready` and `merge`, not `human-qa` or `approve-slices`. The runtime guard uses the same set, so human-qa never bounces to open-pr. This follows the slice Goal ("so the head a person merges is the commit ci watched").
- The runtime move is a norn classify receipt, outcome `unpushed` (added to `CLASSIFIED_OUTCOMES` for gate and merge), with detail `changes since open-pr are not on the PR: <paths>` and route = the workflow's first open-pr step. apply's `backToOpenPr` enters open-pr directly: no edge and no counter. It cannot loop, because open-pr makes the PR head the local head.
- Like `gate.stale`, the guard acts only on a PR fetched this tick. Between syncs it waits (`open_pr.guard.awaits_sync`). It runs after the stale check and before the carried approval.
- Observe (`prUnpushed`, `packages/cli/src/runtime/observe/remote.ts`) fills `pr_unpushed` only when the known open PR's head is an ancestor of the local branch head. A diverged PR head (a person's push) is left to the existing head-changed item.

### Not proven yet
- The rest of the integration tier and the e2e tier run in CI. Only open-pr-guard.test.ts ran here.

### Notes
- `docs/recipes.md` (writing a workflow) has a paragraph on the rule and the runtime return to open-pr.
- The property-test generator (`properties.test.ts`) now draws again when a random workflow fails only on `open_pr_bypass`.
- Friction: AC3 and the observe half of AC2 can only be observed at the integration tier, but the brief says not to run that tier, so this one file was run alone.

### Resume
Review the slice against AC1–AC3 using the Proof table. Weigh the merge-bound reading of AC1 under Easy to miss.
