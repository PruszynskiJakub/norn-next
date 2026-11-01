# AC2: story close in a throwaway repo, branch vs base
Ran the real `story close gh-7 --yes` and then `story reopen gh-7` through the cli harness: a temp repo, real git, a real bare origin, a fake issue tracker (offline: the only providers are gh and glab). The story has a pushed story branch, slice gh-7/01 with a running session, and uncommitted work in the slice worktree. Script: AC2-script.test.ts. A git spawn observer recorded every git call.
Seen (AC2-run.json):
- git order: commit slice → commit story (spec dropped) → push story branch → push slice branch → worktree remove ×2 → branch -D ×2 → claim ref delete on remote and local. Both pushes come before any removal.
- remote: spec.md on the story branch says `status: dropped`; form.txt with the uncommitted work is on origin/gh-7/01-form.
- worktrees gone, only `main` left locally, no refs/norn left, leases released, claim_deleted true.
- `story reopen` exits 0; both worktrees come back, form.txt is restored, spec.md says `status: active`.
The same script against the base branch's code (git archive into $TMPDIR, AC2-base-run.json): normalised (tmp paths, shas, ulids), every field matches, including JSON key order and the full git call sequence (AC2-compare.txt).
