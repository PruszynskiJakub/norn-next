### Goal
The plan's two prefactorings: claim release (`story handoff`, clean `watch` exit) and `story close` push through the one push path that merges a person's push (never rebased), and the `git: update` step's outcome is chosen by a pure core function.

### Proof
- AC1 (same branches, record and order as today; claim released): the existing order tests in `packages/cli/test/integration/release-record.test.ts` (handoff: story branch, slice branch, record, claim deleted; close; watch exit) pass unchanged.
- AC2 (a person's push is merged at release, not refused): `packages/cli/test/integration/release-record.test.ts` › "a person's push to the story branch is merged at claim release, never rebased" — three tests (story handoff, clean watch exit, story close). All three were red first (exit 1, the old not-a-fast-forward refusal / rejected push). `test/e2e/recovery.test.ts` › R3.3 now asserts the merge instead of the refusal.
- AC3 (update ends `done` / `conflict` as today, chosen in core): `packages/core/test/unit/base-sync.test.ts` › "the update step's outcome is chosen by a pure function of the merge result" (red first: the module did not exist). Golden cases (unit tier) and `packages/cli/test/integration/integrate.test.ts` pass unchanged.
- `bun run test` (1757 pass) and `bun run typecheck` are green.

### Easy to miss
- `packages/cli/src/runtime/push.ts` `pushBranch` is the one push path now: `ActEnv.pushBranch` delegates to it, and so do `releaseStory` (runtime/release.ts) and `closeStory` (runtime/close.ts). Slice branches (names with `/`) force-push there, as at every boundary; at release they used to go out as plain pushes behind a fast-forward check, which is gone.
- Release and close now also refuse to push commits that leave conflict markers (`held`), as boundaries already did.
- A failed push result now carries `reason` (git's push reason or `held`) as well as `message`; close keeps reporting `push_reason` from it.
- `updateOutcome` (`packages/core/src/update-outcome.ts`) takes `{ merge }` only. Later slices add the commits since the anchor and the `clean` / `resolved` outcomes there. The stuck cases (dirty worktree, diverged branch) stay in act, before any merge.

### Not proven yet
- The integration and e2e tiers run in CI. Only the touched files were run locally: release-record, integrate, recovery.

### Notes
- I ran the three touched integration/e2e files one at a time, to watch each test go red and then green. I did not run the full tiers.
- The merge commit a release makes carries `Norn-Story`, `Norn-Slice` (slice branches only), `Norn-Step: release` and `Norn-Tick`. Close uses its existing `drop` trailers.

### Resume
Nothing left in this slice. The next slices (push rule, merge step, …) build on `pushBranch` in runtime/push.ts and on `updateOutcome` in core.
