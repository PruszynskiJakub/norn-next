## Summary

When a slice's `merge` step resolves an integrate conflict by merging the story branch in, `git: integrate` now keeps that resolution, instead of rebasing it away and hitting the same conflict again (which used up `conflict_loop` twice on one conflict, W4).

```diff
 integrate(slice, story)                       # W2, packages/cli/src/runtime/integrate.ts
-  git rebase story
+  fork = merge-base(HEAD, story)
+  if a merge sits on the ancestry path fork..HEAD   # the merge step merged story in
+    git merge story  (Norn trailers on the merge)
+  else
+    git rebase story                                # unchanged for every other slice
   fast-forward story to the slice
```

This is the first direction in the issue's Wanted: integrate keeps the merge. The trade-off: once a slice has merged the story branch, the history it brings into the story branch is not linear.

## Evidence

- **Resolved conflict stays resolved when integrate runs again**
  **Before:** plain git: after `git merge --no-ff story` and a resolve, `git rebase story` stops again with `CONFLICT (content): Merge conflict in f` ([plain-git-red.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-80-integrate-s-rebase-drops-the-merge-step/.agents/specs/gh-80-integrate-s-rebase-drops-the-merge-step/runs/_story/evidence/01M63EBK1AYY9RP8EA0G898E00/plain-git-red.txt), script [plain-git.sh](https://github.com/PruszynskiJakub/norn-next/blob/gh-80-integrate-s-rebase-drops-the-merge-step/.agents/specs/gh-80-integrate-s-rebase-drops-the-merge-step/runs/_story/evidence/01M63EBK1AYY9RP8EA0G898E00/plain-git.sh)). Through the full tick loop (harness: integrate conflicts → merge step merges and resolves → `norn done` → integrate): `conflict_loop` reaches 2 and the second classify receipt says `rebase onto gh-7-add-login-form conflicts in f.txt` ([cli-loop-red-2.txt](https://github.com/PruszynskiJakub/norn-next/blob/gh-80-integrate-s-rebase-drops-the-merge-step/.agents/specs/gh-80-integrate-s-rebase-drops-the-merge-step/runs/_story/evidence/01M63EBK1AYY9RP8EA0G898E00/cli-loop-red-2.txt)).
  **After:** the same harness loop, run again on this branch: integrate#2 receipt says `gh-7/01-form integrated into gh-7-add-login-form at efb13f2…`, the slice reaches `$done`, `conflict_loop` stays at 1 (1 pass). Regression test in `packages/cli/test/integrate.test.ts`: `integrate → conflict; git merge --no-ff story + resolve; integrate → done, story HEAD:a.txt == "both sides"`. It was red (conflict) before the fix and is green now.
- **…and also when the story branch moves on after the merge step** (review#1 F1: `--rebase-merges`, the first attempt, brought the conflict back here)
  **Before:** a rebase re-creates the merge on the new story tip, and the same conflict comes back.
  **After:** regression test `integrate.test.ts` "the resolution stays when the story branch moves on after the merge step": another commit lands on the story branch, integrate → `done`, the story branch has both `a.txt == "both sides"` and the other slice's `b.txt`, and the merge carries the `Norn-Tick` trailer. Red before, green now. `integrate.test.ts` 12/12 pass, typecheck green, full suite green (1223 pass) at implement#2.
- **Slices that never merged still rebase**: the e2e effect transcript changes by three read-only probes (`rev-list --left-right`, `merge-base`, `rev-list --merges --ancestry-path`) before each `git rebase`, which itself is unchanged.

## Merge danger

**Door:** two-way: code only, no persisted format changes. A revert brings back the plain rebase.

**Blast radius:** slice integrations: only slices whose history holds a merge since the fork point now merge instead of rebasing, so the story branch can carry merge commits. The `conflict` receipt detail still says "rebase onto …" when the merge is what conflicted. PRD W2 ("rebase + fast-forward") and the norn-merge skill text are not amended yet: that needs a follow-up through the spec workflow.
