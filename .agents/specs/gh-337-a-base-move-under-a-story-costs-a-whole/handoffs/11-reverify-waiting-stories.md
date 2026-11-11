### Goal
When the base moves under a story waiting at `ready` or a merge step without a textual conflict, norn runs the workflow's `base.verify` check on the merged tree locally, once per (head, base sha); red sends the story through `update`.

### Proof
| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | `base.verify` naming a check step validates; with `stale: behind` or a non-check step it is refused with the reason; shipped story/quick (both copies) set it to `test` | test | `packages/core/test/unit/base-sync.test.ts` › "base.verify naming a check step validates; …"; `packages/cli/test/unit/assets.test.ts` › "story and quick wait for CI … and test re-verifies a waiting story, in both copies" |
| AC2 | a story waiting at ready or merge whose base moved cleanly runs the verify check detached on the merged tree in a temp worktree, a check slot taken, no push/CI/approval | test | `base-sync.test.ts` › "a story waiting at ready or the merge step whose base moved without a conflict runs the verify check …"; `packages/cli/test/integration/reverify.test.ts` › "a clean base move runs the verify check once on the merged tree in a temporary worktree; …" |
| AC3 | a verify run already recorded for the head + base sha is not ordered again; a new base sha orders a new one | test | `base-sync.test.ts` › "a verify run already recorded for the story head and base sha is not ordered again; …"; S3 test above |
| AC4 | no free check slot → no verify ordered until one is | test | `base-sync.test.ts` › "with no check slot free no verify run is ordered until one is" |
| AC5 | a red verify takes the waiting step's `stale` edge to update through `stale_loop`, the failure is the next brief's `last_check`; the counter max stops it | test | `base-sync.test.ts` › "a red verify run takes the waiting step's stale edge …"; `reverify.test.ts` › "a base move the merged tree fails on sends the story through update, …" ; `base-sync.test.ts` › "a red verify run ordered at ready whose receipt lands after a person approved ready still takes the stale edge from the merge step the story now waits at" (review#1 F1, red first) |
| AC6 | a green verify leaves the story where it waits | test | `base-sync.test.ts` › "a green verify run leaves the story where it waits" |
| AC7 | a workflow without `base.verify` orders no verify | test | `base-sync.test.ts` › "a workflow without base.verify orders no verify run" |

- review#2 approved at 128c30bdf: `bun run test` (1875 pass) and `bun run typecheck` re-run green; every criterion traced to a test read and seen to assert it.

### Easy to miss
- The verify receipt is a `check` receipt at the *waiting* step (`ready`/`merge`), with `verify: {head, base}`; `apply.ts` › `verified()` handles it before the "not a check step" refusal. Green returns the same state; red does `take(toReady(st), "stale", …)`, so the counter and exhausted path are the stale edge's. With no `stale` edge it stays put (plan D11 said "today's Check item"; none exists for a non-conflicting base, so nothing new is shown).
- A verify receipt skips apply's step/attempt cursor check whenever the unit is parked at a gate or merge step (`apply.ts` › `verifyRun`): the cache counts every written verify receipt, so a refused red one would be lost for good. A pass at ready then approve still caches the pair, so merge does not re-run it.
- Verify ignores the check step's `exits`: any non-zero exit is `fail`, so brief's `last_check` (which looks for `outcome: fail`) picks it up.
- The cache is `StoryFacts.verified`, from the story unit's newest check receipt with `verify` (`store/src/local-facts.ts` › `lastVerify`), read only when the pinned workflow sets `base.verify`.
- Between syncs (`pr` undefined, `pr_seen` has a PR), verify waits (`verify.awaits_sync`) like `gate.stale.awaits_sync`: a squash-merged own PR must end the story, not trigger a verify.
- Verify runs only after `carriedApproval` and the stale/unpushed checks in the parked branch of decide.

### Not proven yet
- Minor notes for the person, not rework (review#1, still open at review#2): a killed `norn check-run` leaks its norn-verify- worktree (`sweepCheckOrders` in `cli/src/runtime/act/check.ts:190` unlinks the order without removing `order.verify`); classify's doc comment sits above `verified()` in `apply.ts:446`.
- Integration and e2e tiers as a whole run in CI.

### Notes
- Act (`cli/src/runtime/act/check.ts`): `mergedTree` = `worktreeAddDetached(root, tmp, head)` + `git.merge(tmp, base)` (merge commit on no branch). It uses existing GitPort operations, so the S4 contract is unchanged. The order's `cwd` is the temp worktree, its env still comes from the story worktree's `.env.norn`. `norn check-run` removes the worktree in its `finally`. If the merge conflicts (a race with observe), act throws and the lease is released; the next tick sees the conflict and takes the stale route.
- Schema: `BaseSync.verify`, `CheckReceipt.verify` (`VerifyPair` in common.ts), `CheckOrder.verify {head, base, repo, worktree}`, new workflow issue code `base_verify`.
- Docs: `docs/recipes.md` (base moved section, now says red applies from whichever of ready/merge the story waits at), `docs/concepts.md` (merge row).
- F1 fix chosen over "cache only applied receipts": store cannot tell an applied receipt from a refused one without replaying apply (a red verify moves the cursor itself, as does an earlier approve). Known residue: apply has no head, so a verify receipt landing after the head changed while the story is parked again would still apply; head changes pass through non-parked steps, so this needs a run that outlives a whole update round.

### Resume
QA the slice against AC1–AC7 (review#2 approved; the findings file has the two minor notes).
