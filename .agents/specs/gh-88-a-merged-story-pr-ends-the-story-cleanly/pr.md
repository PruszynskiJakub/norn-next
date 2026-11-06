## Summary

When a story's PR is merged while a unit is still parked (at the `ready` gate, an ask, anything), GR6 cleanup now records every unfinished unit `done`. The story leaves the inbox's Approve, Your turn and Running lists, and `story wait --until done` returns. #72 (a workflow merging its own PR) is not in this round: by the person's decision it gets its own refinement round.

```diff
 decide: PR merged → cleanup_merged_story
+  finish = each unit with a valid state, not yet done
+           → state { status: done, park: null, run: null, step kept }
+           (a unit that failed validation is left as it is, S2)

 act: cleanupMerged
+  write each finish state           ← before the archive, so the record carries it
   push final record to refs/norn/runs/<story>
   remove worktrees, branches, claim and mailbox refs
```

A failed archive push leaves the cleanup owed. The next tick decides it again and writes the same states. GR6 in `.agents/RULES.md` is amended to say this.

## Evidence

No QA run on this round (quick workflow). The evidence is the tests below, from #88's Wanted list.

- **W1** A story merged while parked leaves Approve / Your turn / Running
  **Before:** gh-60, gh-69 and gh-76 stayed under **Approve** after their PRs were merged at `ready`.
  **After:** `decide.test.ts` › "gh-88 GR6: a PR merged while parked at a gate → …". A story parked at a gate, with one slice stuck on an ask, gets merged. Assertion: `finish` = both units `done`, `park: null`, `run: null`, step kept. `buildInbox` over the facts after cleanup shows only a `recently_done` item for the story.
- **W2** The unit's `state.json` is `done` after cleanup
  **Before:** `state.json` stayed `{status: parked, park: {kind: gate}}`, because cleanup rewrote only `story.md`.
  **After:** `runtime.test.ts` › "PR merged → … a unit parked at merge time recorded done (GR6, gh-88)". The unit is parked at a gate, then `norn sync` runs with the PR merged. Assertion: `state.json` matches `{status: done, park: null, run: null}`. This test was red without the act change.
- **W3** No claim held or renewed for a story main records done
  **Before:** gh-69 and gh-76 took their claims again after cleanup.
  **After:** the same runtime test asserts `refs/norn/claims/gh-9` is gone from origin. A unit recorded `done` gives later ticks nothing to work on, and R3.2 already refuses to take the claim again for a done story. No test covers a re-claim over several ticks.
- **#72** A workflow merges its own PR: **not shown**. It is out of this round by the person's decision.

The golden corpus changes in 3 cases, only by the new `finish` field. The `base-sync` effect transcript gains one `state.json` write at cleanup.

## Merge danger

**Door:** two-way. A revert drops the extra state write. Stories this version has already cleaned up keep their `done` state, which is harmless.

**Blast radius:** merged stories. Only stories whose PR was merged are affected. If this is wrong, a unit could be marked `done` too early, but this runs only after `pr.state === "merged"`. Stories cleaned up by an older norn (gh-60, gh-69, gh-76) are not repaired and stay in the inbox until they are fixed by hand or by a follow-up.
