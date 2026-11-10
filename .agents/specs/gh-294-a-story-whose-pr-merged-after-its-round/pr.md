## Summary

A story whose PR merges after its round reached `$done` was never recorded done: nobody held the claim, so decide said `story.finished` and never cleaned up, and the story stayed in the cockpit's Needs you. Now the checkout whose round ran takes the claim back, and the next tick runs the merge cleanup. A second, smaller fix: cockpit item rows for a story with more than one row now say what each item asks for.

```diff
 decideStory(story)
+  if PR merged and base record not done
+     and claim none and this checkout has run state and the story worktree exists
+    acquire claim (claim.reacquire.merged)    // next tick: cleanup_merged_story → status: done
   if base done or (PR merged and claim not ours)
     noop story.finished
```

## Evidence

No QA ran; the entries are tests (unit tier, `bun run test` green, test check passed).

- **A merged story is recorded done, also after its round reached `$done` with no claim held**
  **Before:** decide gave `noop story.finished` on every tick; `cleanup_merged_story` was never emitted, the record stayed `active`.
  **After:** `decide.test.ts` › "a story whose round ran and whose PR merged is taken back for the merge cleanup though nobody holds its claim": claim `none` + PR merged + `$done` → `claim.reacquire.merged` acquire; once held → `cleanup_merged_story` with `story_status: done`; no worktree left, or record already `done` → noop. Failed first, passes now.
- **Each cockpit item row says what its item asks for when its story has more than one row**
  **Before:** every row showed the story's title, e.g. gh-274 three times as "Cap what the brief pastes…".
  **After:** `cockpit-tui.test.ts` › "a story with more than one item row: each row says what its item asks for": each row shows its item's title. Failed first, passes now. A single row still shows the story's title.

Gaps the review accepted: stories already closed with `norn story close` (gh-222, gh-271, gh-292) have no worktree, so they are not taken back; land `status: done` on the base for them by hand. No integration test; the fix is proven at the decide seam over two ticks.

## Merge danger

**Door:** two-way: decide and cockpit rendering only; no format or schema change, a revert restores the old behaviour.

**Blast radius:** merged stories: a wrong guard could re-acquire and re-run the merge cleanup each tick. The worktree condition stops that once cleanup has run; a worktree removal that keeps failing retries every tick until it succeeds.
