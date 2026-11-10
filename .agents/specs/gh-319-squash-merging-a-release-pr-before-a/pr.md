## Summary

A story whose own PR was squash-merged while it waited at a gate no longer reads as "base moved", goes through `update` and opens a second PR. It waits for the next sync, which sees the PR merged and ends the story through the merge path.

```diff
 decide: gate with a `stale` route, base moved
+  if the story has a PR seen here and no PR was fetched this tick
+    noop "gate.stale.awaits_sync"     // the sync's remote.pr_merged ends the story
   classify stale → update

 act: open-pr
+  if the branch's PR is already merged
+    fail the effect, open nothing     // retried each tick until the sync ends the story
   push, write body, open or edit the PR
```

## Evidence

No QA ran; the entries are tests (`bun run test` 1734 pass, typecheck green, `test/e2e/merged-pr.test.ts` passes locally).

- **No stale when the story's own PR merged**
  **Before:** a non-sync tick after the squash classified the gate `gate.stale`, then `git.update`.
  **After:** `base-sync.test.ts` › "4a: a story PR not fetched this tick holds the stale gate until a sync shows whether the PR merged": unfetched PR + moved base → noop `gate.stale.awaits_sync` (red before the fix; rule case `gate.stale.awaits_sync`).
- **A merged PR ends the story through the merge path**
  **Before:** the squash was merged back into the branch and the story reworked.
  **After:** `merged-pr.test.ts` › "squash-merged and the base fetched between syncs: the stale gate waits for the sync, which ends the story; no second PR" — squash merge, fetch base, tick → `gate.stale.awaits_sync`, gate still parked; sync → `remote.pr_merged`, PRs == ["#100 merged"] (red before: `gate.stale`, `git.update`, …).
- **Never a second PR**
  **Before:** `open-pr` opened a second PR for the same branch.
  **After:** `merged-pr.test.ts` › "opens no second PR and fails the effect; the next sync ends the story" — merged PR + reject back to open-pr → `git.open-pr FAILED … already merged`, PR count stays 1; sync → `remote.pr_merged` (red before the act guard).
- **A base that moved under an open PR still goes stale** (unchanged behaviour)
  **After:** same "4a" test, second case: fetched open PR + moved base → `gate.stale` → update.

Not covered: the gh adapter's `prsQuery` returns only the newest PR for a branch, so a merged PR is hidden once a newer one exists; left alone since both guards stop that newer PR from being opened.

## Merge danger

**Door:** two-way: decide and act logic only, no persisted format or schema change.

**Blast radius:** stories at stale gates: a story with a PR now waits up to one `sync_interval` before going back through update, and `open-pr` makes one more PR lookup before pushing. Stories without a PR, and host-less setups, behave as before.
