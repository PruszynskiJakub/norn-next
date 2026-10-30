## Summary

While a rebase waits in a unit's worktree, its `runs/` is a rewound copy, so a tick now holds that unit instead of deciding and writing against it. Before, a tick could classify an old deadline, write a receipt numbered from the rewound state, and leave the unit `corrupt` once the rebase was aborted. Also, when a collision does happen, the inbox now names the stray receipt, and the stuck hint points to a command that works.

```diff
 decideUnit(unit)
+  if worktree.in_progress.operation == "rebase"
+    noop unit.rebase_in_progress   // nothing classified, applied, marked corrupt or committed
+    return
   if unit.errors → unit.corrupt …
   …deadlines, receipts, commit

 storyLifecycle(story)
   merged PR → cleanup            // unchanged
+  if story unit rebasing → return // no remote.park / remote.mirror / refined hash
 importMailbox(receipt)
+  target unit rebasing → wait    // neither imported nor rejected against the rewound cursor
 slicesStuck
+  rebasing slice → still progressing
-  "… — norn unstick <slice>"
+  "… — norn why <slice>"  when the slice is corrupt (unstick refuses a corrupt unit)
 corrupt inbox title
-  "corrupt: <file> failed validation (S2)"
+  "corrupt: <file> failed validation (S2): duplicate receipt number 2 (also 0002-classify.json)"
```

A merge, cherry-pick or revert does not rewind `runs/`, so those keep BS5.1 as it is (deadlines and liveness still decided).

## Evidence

- **Mid-rebase, the tick writes nothing into the rewound `runs/`** (CLI harness, real git: unit moves to `second` with receipt 2, then `git rebase old` stops on a conflict and rewinds `runs/` to `first`, 1 receipt, with `first`'s deadline long past)
  **Before:** the tick ran `agent.timeout.surface`, wrote an untracked `0002-classify.json` and a modified `state.json` ([loop-red.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-79-a-tick-mid-rebase-acts-on-rewound-runs/.agents/specs/gh-79-a-tick-mid-rebase-acts-on-rewound-runs/runs/_story/evidence/01M63EBXC9NZBFZQ7BRHQPEKP4/loop-red.txt), [user-side.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-79-a-tick-mid-rebase-acts-on-rewound-runs/.agents/specs/gh-79-a-tick-mid-rebase-acts-on-rewound-runs/runs/_story/evidence/01M63EBXC9NZBFZQ7BRHQPEKP4/user-side.txt)).
  **After:** `packages/cli/test/rebase-rewind.test.ts` asserts `acted == []`, a `unit.rebase_in_progress` decision, and receipts `== [0001-started.json]`. Passes.
- **After `git rebase --abort`, the unit is not corrupt**
  **Before:** the next tick ran `unit.corrupt` ("duplicate receipt number 2 (also 0002-classify.json)"), and every later tick was a `unit.corrupt` noop. `norn unstick` refused with exit 3 ([user-side.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-79-a-tick-mid-rebase-acts-on-rewound-runs/.agents/specs/gh-79-a-tick-mid-rebase-acts-on-rewound-runs/runs/_story/evidence/01M63EBXC9NZBFZQ7BRHQPEKP4/user-side.txt)).
  **After:** the same test asserts `acted == []`, state `{step: second, status: ready}`, and receipts `== [0001-started, 0002-done]`. Passes.
- **Story-level writes held too** (`remote.park`, `remote.mirror`, refined hash into a rebasing story worktree; a merged PR is still cleaned up)
  **Before:** these ran before the unit hold and wrote `state.json`/`story.md` from the rewound copy (review#1 F1).
  **After:** decide tests `gh-79 (H1, S5): a rebasing story worktree holds the story-level writes` in `packages/core/test/decide.test.ts`. Each failed before its change and passes now.
- **Mailbox receipt waits for a rebasing unit**
  **After:** decide test asserts the receipt is neither imported nor rejected as stale while its unit is mid-rebase. Failed before, passes now.
- **A collision names the stray file, and the hint does not point to a refusing command**
  **Before:** the inbox showed `corrupt: …/0002-done.json failed validation (S2)` (the valid, committed file), and `slices.slice_stuck` said `norn unstick`, which refuses a corrupt unit.
  **After:** decide tests assert that the title ends with `: duplicate receipt number 2 (also 0002-classify.json)` and that a corrupt slice's stuck detail says `norn why <slice>`. One golden case's title was updated to match (`runtime-3aec7a560471.json`). New golden case `rebase-rewind` and rule case `unit.rebase_in_progress`.
- Full suite: `bun test` 1233/1233 and `bun run typecheck` clean at review#2.
- **Not covered:** "a receipt norn wrote but never committed can never collide" holds only through the rebase hold. The store's duplicate-number check still cannot tell a stray file from a committed one.

## Merge danger

**Door:** two-way: decide logic and one inbox title string. No persisted format changes, and a revert restores the old behaviour.

**Blast radius:** units mid-rebase: a unit whose worktree is left in a rebase is held with only a trace noop. Nothing reaches the inbox and no deadline fires, so a forgotten rebase stalls that unit quietly until someone concludes it (follow-up suggested). Known gaps, not regressions: `slice.done.cleanup` still integrates a finished slice into a story worktree that is mid-rebase, and BS5.1 in `.agents/SPEC-base-sync-and-qa.md` still reads as if every rule runs during a rebase (spec amendment pending).
