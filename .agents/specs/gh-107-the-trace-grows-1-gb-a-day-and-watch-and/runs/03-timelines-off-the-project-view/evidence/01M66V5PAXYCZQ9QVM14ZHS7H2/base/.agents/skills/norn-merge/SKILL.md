---
name: norn-merge
description: Bring a branch up to date with its target and resolve conflicts by the intent of both sides, keeping both, then prove it with the tests; abort and stop when a resolution would need new behaviour. Use when a merge, rebase or cherry-pick stopped on conflicts, or when a published branch must be brought up to date with its base.
---

# Merge

Resolve conflicts so that both sides' intended behaviour survives. You are combining work, not choosing a winner. Commit locally; never push.

## Bringing a published branch up to date with its base

When you are asked to merge a base commit into a published branch (the branch has a pull request, other branches were cut from it, or someone reviewed its head):

1. Merge, in the given worktree: `git merge --no-ff <base commit>`. **Never rebase** a published branch, and never force-push it.
2. Resolve each conflict by intent (below). For the base side, read the change that introduced it: `git log <merge base>..<base commit> -- <file>`.
3. Run the repo's checks (type check, the full test suite, formatting) and fix anything the merge broke.
4. Commit the merge (`git commit --no-edit`, or with the trade-off noted).

## Any other conflict

1. See where you are: `git status`, which operation is in progress (merge, rebase, cherry-pick), and the list of conflicted files. When nothing is in progress, bring the branch up to date with its target the way you were asked (merge by default), which stops on the same conflicts.
2. Resolve each conflict by intent (below).
3. Check for semantic conflicts too: code that merged cleanly but now calls renamed functions, duplicates logic, or breaks the other side's tests.
4. Run the type check and the full test suite. Both sides' tests must pass.
5. Continue the operation (`git add`, then `git rebase --continue` / `git commit`) until it completes. Never use `--skip`, `-X ours/theirs`, or reset either side away.

## Resolve each conflict by intent

For each hunk, find the primary sources on both sides: the commits that touched those lines (`git log -p --merge`, `git log <base>..<side> -- <file>`), their messages, the spec and acceptance criteria each side serves, and the tests each side added. Preserve both intents where possible:

- both added different things: keep both, in a sensible order;
- one side refactored, the other changed behaviour: apply the behaviour change to the refactored code;
- both changed the same behaviour differently: follow the spec of the work on this branch, and note the trade-off in the merge commit message; when the spec does not say which wins, stop.

Resolve to existing behaviour only. Otherwise always finish the merge.

## Stop when

- Keeping both intents would need behaviour that neither side has (a new rule, a product decision).
- The sides contradict each other and the spec does not say which wins.
- You cannot tell what one side meant.

Then abort the operation in progress (`git merge --abort`, `git rebase --abort` or `git cherry-pick --abort`), leaving the worktree clean, and stop with why: which files, what each side wants, and the decision needed.

Done when no conflict markers remain, the operation completed and is committed, both sides' behaviour and tests survive, and the full suite passes — or, when you stopped, the operation is aborted, the worktree is clean, and you said which decision is needed.
