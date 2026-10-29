# Release 0.11.1

**Version:** 0.11.1, from the issue's `## Version`. A patch release: both changes are fixes (#97, #98), with nothing Added, Changed or Removed and no machine contract change.

## [0.11.1] - 2026-10-29

### Fixed

- A tick no longer acts on a unit whose worktree is mid-rebase. A rebase rewinds `runs/` to an older copy, and a tick used to decide and write against it: it could fire an old deadline, write a receipt numbered from the rewound state, and leave the unit `corrupt` once the rebase was aborted. Now the unit is held with a `unit.rebase_in_progress` noop, story-level writes (`remote.park`, `remote.mirror`, the refined hash) wait, and a mailbox receipt for it is neither imported nor rejected until the rebase ends (S5). A merge, cherry-pick or revert does not rewind `runs/` and is decided as before (BS5.1).
  - A corrupt unit's inbox title names the stray file behind a duplicate receipt number (`duplicate receipt number 2 (also 0002-classify.json)`), and a corrupt slice's stuck hint points to `norn why <slice>` instead of `norn unstick`, which refuses a corrupt unit.
- `git: integrate` keeps the resolution a slice's `merge` step made. When the slice's history holds a merge since its fork point (the merge step merged the story branch in), integrate merges the story branch instead of rebasing onto it, so the same conflict no longer comes back and uses up `conflict_loop` twice (W2, W4). Slices without such a merge still rebase; once one has merged, the story branch carries that merge commit.
