## Summary

A story whose PR merges after its round reached `$done` was never recorded done: nobody held the claim, so decide said `story.finished`, never ran the merge cleanup, and the story stayed in the cockpit's Needs you. Now the checkout whose round ran takes the claim back, and the next sync runs the merge cleanup. A second, smaller fix: cockpit item rows for a story with more than one row say what each item asks for.

```diff
 decideStory(story)
+  if PR merged and base record not done
+     and claim none and this checkout has run state and the story worktree exists
+    acquire claim (claim.reacquire.merged)    // next sync: cleanup_merged_story → status: done
   if base done or (PR merged and claim not ours)
     noop story.finished
```

## Evidence

No QA ran; the entries are tests. The unit-tier test check passed on this head; the integration test was run locally (it is CI's tier).

- **A merged story is recorded done, also after its round reached `$done` with no claim held**
  **Before:** every tick gave `noop story.finished`; `cleanup_merged_story` was never emitted and the record stayed `active`.
  **After:** `runtime.test.ts` › "PR merged after the round finished": round at `$done` → `watch --max-ticks 1` releases the claim → PR merged on the remote → sync gives `claim.reacquire.merged`, next sync gives `cleanup_merged_story`; worktree gone, run state `done`, `origin/main` spec says `status: done`. Fails with the take-back disabled, passes now. The decide seam is pinned by `decide.test.ts` › "a story whose round ran and whose PR merged is taken back for the merge cleanup though nobody holds its claim" (no worktree left, or record already `done` → noop). That test failed first.
- **Each cockpit item row says what its item asks for when its story has more than one row**
  **Before:** every row showed the story's title, e.g. gh-274 three times as "Cap what the brief pastes…".
  **After:** `cockpit-tui.test.ts` › "a story with more than one item row: each row says what its item asks for": each row shows its item's title. Failed first, passes now. A single row still shows the story's title.

Gaps the review accepted: stories already closed with `norn story close` (gh-222, gh-271, gh-292) have no worktree, so they are not taken back. Land `status: done` on the base for them by hand.

## Merge danger

**Door:** two-way: decide and cockpit rendering only; no format or schema change, so a revert restores the old behaviour.

**Blast radius:** merged stories: a wrong guard could re-acquire and re-run the merge cleanup on every tick. The worktree condition stops that once the cleanup has run. If removing the worktree keeps failing, the cleanup retries each sync until it succeeds.
