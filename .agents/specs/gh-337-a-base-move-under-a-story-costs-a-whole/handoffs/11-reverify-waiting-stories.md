### Goal
When the base moves under a story waiting at `ready` or a merge step without a textual conflict, norn runs the workflow's `base.verify` check on the merged tree locally, once per (head, base sha); red sends the story through `update`.

### Proof
- AC1 (`base.verify` validates; invalid with `stale: behind` or a non-check step; shipped story/quick set it to `test`, both copies): `packages/core/test/unit/base-sync.test.ts` › "base.verify naming a check step validates; …"; `packages/cli/test/unit/assets.test.ts` › "story and quick wait for CI … and test re-verifies a waiting story, in both copies".
- AC2 (verify runs detached on the merged tree in a temp worktree, takes a check slot, no push/CI/approval): S1 `base-sync.test.ts` › "a story waiting at ready or the merge step whose base moved without a conflict runs the verify check …"; S3 `packages/cli/test/integration/reverify.test.ts` › "a clean base move runs the verify check once on the merged tree in a temporary worktree; …" (cwd under `norn-verify-`, removed afterwards, the base's file in `ls`, remote refs other than main unchanged, no PR, no approve receipt).
- AC3 (cached per head + base sha): `base-sync.test.ts` › "a verify run already recorded for the story head and base sha is not ordered again; a new base sha orders a new one"; S3 test above (3 more ticks, one verify receipt).
- AC4 (no free check slot → none ordered): `base-sync.test.ts` › "with no check slot free no verify run is ordered until one is".
- AC5 (red → `stale` edge to update through `stale_loop`, failure as `last_check`, counter max stops it): `base-sync.test.ts` › "a red verify run takes the waiting step's stale edge …"; S3 `reverify.test.ts` › "a base move the merged tree fails on sends the story through update, the failure on record".
- AC6 (green stays): `base-sync.test.ts` › "a green verify run leaves the story where it waits".
- AC7 (no `base.verify` → nothing): `base-sync.test.ts` › "a workflow without base.verify orders no verify run".
- The S1 tests for AC2–AC5 went red with the `reverify` call in `decide/story.ts` disabled. New rule ids `verify.run`, `verify.awaits_sync` have hand-built cases in `packages/core/test/rule-cases.ts`.
- `bun run test` (1874 pass), `bun run typecheck` green; `schema:emit` and `docs:emit` run; the one integration file run locally, green.

### Easy to miss
- The verify receipt is a `check` receipt at the *waiting* step (`ready`/`merge`), with `verify: {head, base}`; `apply.ts` › `verified()` handles it before the "not a check step" refusal. Green returns the same state; red does `take(toReady(st), "stale", …)`, so the counter and exhausted path are the stale edge's. With no `stale` edge it stays put (plan D11 said "today's Check item"; none exists for a non-conflicting base, so nothing new is shown).
- Verify ignores the check step's `exits`: any non-zero exit is `fail`, so brief's `last_check` (which looks for `outcome: fail`) picks it up.
- The cache is `StoryFacts.verified`, from the story unit's newest check receipt with `verify` (`store/src/local-facts.ts` › `lastVerify`), read only when the pinned workflow sets `base.verify`.
- Between syncs (`pr` undefined, `pr_seen` has a PR), verify waits (`verify.awaits_sync`) like `gate.stale.awaits_sync`: a squash-merged own PR must end the story, not trigger a verify.
- Verify runs only after `carriedApproval` and the stale/unpushed checks in the parked branch of decide.

### Not proven yet
- Integration and e2e tiers as a whole run in CI.

### Notes
- Act (`cli/src/runtime/act/check.ts`): `mergedTree` = `worktreeAddDetached(root, tmp, head)` + `git.merge(tmp, base)` (merge commit on no branch). It uses existing GitPort operations, so the S4 contract is unchanged. The order's `cwd` is the temp worktree, its env still comes from the story worktree's `.env.norn`. `norn check-run` removes the worktree in its `finally`. If the merge conflicts (a race with observe), act throws and the lease is released; the next tick sees the conflict and takes the stale route.
- Schema: `BaseSync.verify`, `CheckReceipt.verify` (`VerifyPair` in common.ts), `CheckOrder.verify {head, base, repo, worktree}`, new workflow issue code `base_verify`.
- Docs: `docs/recipes.md` (base moved section), `docs/concepts.md` (merge row).

### Resume
Nothing left in this slice; next is the test check (`bun run test`, `bun run typecheck`).
