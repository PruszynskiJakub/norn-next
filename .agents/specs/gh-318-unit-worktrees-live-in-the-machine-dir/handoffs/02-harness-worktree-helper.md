## Goal
Integration and e2e tests, and the transcript harness's watched folders, name a unit worktree through one helper instead of spelling `${root}-worktrees/…`, so slice 03 moves the folder by changing one file. Nothing norn does changes.

## Proof
- Helper: `test/support/worktree.ts` — `worktreesOf(root)` (the folder) and `worktreeOf(root, dirName)` (one worktree); `h.worktree(dirName)` on the harness, `clone.worktree(dirName)` on `cloneOf` clones and on `test/e2e/recovery.test.ts`'s own clone type. `harness.ts` re-exports both functions.
- AC1 (the harness gives the worktree path; existing tests pass with transcripts unchanged): `bun run test` 1732 pass, `bun run typecheck` clean; `bun run test:e2e test/e2e/recovery.test.ts` 7 pass, its transcript unchanged (no diff). The rest of the integration and e2e tiers run in CI.
- AC2 (no hand-spelled `-worktrees` left outside the helper): `grep -rn -- '-worktrees' packages/*/test/integration/*.ts test/e2e/*.ts test/support` returns only `test/support/worktree.ts`. The transcript's watched folders use `worktreesOf(root)`.

Review #1 traceability:

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | the harness gives a unit worktree's path by folder name (also for a second clone); every existing integration and e2e test passes through it with pinned transcripts unchanged | test | `test/support/worktree.ts` used by `h.worktree` / `clone.worktree` across the integration and e2e suites (e.g. `test/e2e/recovery.test.ts` › "R3.1: both clones intake the issue…" via `B.worktree`); `bun run test` 1732 pass, typecheck clean at review; no diff under `test/e2e/transcripts` or `observe-snapshots` |
| AC2 | no hand-spelled `-worktrees` path left in integration tests, e2e tests or test support outside the helper (transcript watched folder included) | agent | QA (agent): the reviewer's grep found only `test/support/worktree.ts` plus recorded view fixtures (pinned data, out of scope) |

## Easy to miss
- Pure refactor: no behaviour change, so no new red test. Every existing test is the proof.
- Recorded data stays as it is: the view fixtures (`packages/view/test/integration/fixtures/gh-1/**`, real paths from a sandbox run), the e2e observe snapshots and transcripts, the golden corpus, and core unit-test fixtures (`rule-cases.ts`, `fixtures.ts`). They are outside this slice's AC2 scope (they are pinned outputs, not paths a test spells), and slice 03 rewrites them with their own update commands.
- Two fake Herdr cwds meant as "another repo's worktree" (`story-view.test.ts`, `segment.test.ts`) now read `/other-repo/worktrees/gh-N-x`. They still sit outside this repo, which is what those tests check.

## Not proven yet
- The full integration and e2e tiers (CI only, by rule).

## Notes
- The helper spells the old folder itself because it cannot depend on slice 01's `worktreesDir`. Slice 03 changes `worktreesOf` to `worktreesDir(root)` from `@norn/store`. view's integration test imports `test/support/worktree.ts` directly, so keep that module light (no cli imports).
- `version-guard.test.ts` and `story-create.test.ts` check the worktrees folder as a whole through `worktreesOf(h.root)`.

## Resume
Review #1 approved with no findings; next is the slice's QA step (AC2 is agent-verified).
