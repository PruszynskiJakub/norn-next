### Goal
The plan's two prefactorings: claim release (`story handoff`, clean `watch` exit) and `story close` push through the one push path that merges a person's push (never rebased), and the `git: update` step's outcome is chosen by a pure core function.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | remote at or behind local: handoff, clean watch exit and close push the same branches and record in the same order as today, and release the claim | test | `packages/cli/test/integration/release-record.test.ts` › the existing order tests for handoff, close and watch exit (file only appended to; pass unchanged) |
| AC2 | a person's commit on the story branch is merged with norn's local boundary at handoff, watch exit and close (no rebase, neither dropped), instead of a not-a-fast-forward refusal | test | `packages/cli/test/integration/release-record.test.ts` › "a person's push to the story branch is merged at claim release, never rebased" (three tests: both commits are ancestors of the remote head, the head is a two-parent merge, the claim ref is gone); `test/e2e/recovery.test.ts` › R3.3 |
| AC3 | `git: update` ends `done` on a clean merge and `conflict` on a conflict, as today, chosen by a core function of the merge result; golden cases and integrate tests unchanged | test | `packages/core/test/unit/base-sync.test.ts` › "the update step's outcome is chosen by a pure function of the merge result"; golden cases (no diff) and `packages/cli/test/integration/integrate.test.ts` (no diff) pass |
| User story: a person's push merges with norn's local boundaries, never rebased (at claim release) | same as AC2 | test | as AC2 |

Review #1 ran `bun run test` (1757 pass), `bun run typecheck` (clean), and the touched integration and e2e files (release-record and integrate: 24 pass; recovery: 7 pass).

### Easy to miss
- `packages/cli/src/runtime/push.ts` `pushBranch` is the one push path now: `ActEnv.pushBranch` delegates to it, and so do `releaseStory` (runtime/release.ts) and `closeStory` (runtime/close.ts). Slice branches (names with `/`) force-push there, as at every boundary; at release they used to go out as plain pushes behind a fast-forward check, which is gone.
- Release and close now also refuse to push commits that leave conflict markers (`held`), as boundaries already did.
- A failed push result now carries `reason` (git's push reason or `held`) as well as `message`; close keeps reporting `push_reason` from it.
- `updateOutcome` (`packages/core/src/update-outcome.ts`) takes `{ merge }` only. Later slices add the commits since the anchor and the `clean` / `resolved` outcomes there. The stuck cases (dirty worktree, diverged branch) stay in act, before any merge.

### Not proven yet
- The full integration and e2e tiers run in CI; locally only the touched files ran (release-record, integrate, recovery).

### Notes
- Review #1: approve, two minor notes for the person (findings file passed with the report): release no longer checks every branch before pushing any, so a later slice push can fail after the story branch went out (the claim and record still wait); and a release under an expired claim now force-pushes slice branches without the old fast-forward guard. Both match how boundaries already push.
- The merge commit a release makes carries `Norn-Story`, `Norn-Slice` (slice branches only), `Norn-Step: release` and `Norn-Tick`. Close uses its existing `drop` trailers.

### Resume
Nothing left in this slice. The next slices (push rule, merge step, …) build on `pushBranch` in runtime/push.ts and on `updateOutcome` in core.
