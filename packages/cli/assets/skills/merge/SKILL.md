---
name: merge
description: Resolve git merge or rebase conflicts by understanding the intent of both sides and keeping both, then prove it with the tests; stop when a resolution would need new behaviour. Use when a rebase, merge or cherry-pick stopped on conflicts, or when a published branch must be brought up to date with its base.
---

# Merge

Resolve conflicts so that both sides' intended behaviour survives. You are combining work, not choosing a winner.

## Bringing a branch up to date with its base

When you are asked to merge a base commit into a published branch (the branch has a pull request, other branches were cut from it, or someone reviewed its head):

1. Merge, in the given worktree: `git merge --no-ff <base commit>`. **Never rebase** a published branch, and never force-push it.
2. **Resolve each conflict by intent.** For each hunk, find the sources on both sides: the commit messages, the spec and acceptance criteria of the work on this branch, and the change that introduced the base side (`git log <merge base>..<base commit> -- <file>`). Preserve both intents where possible. Where they are incompatible, follow this branch's spec and note the trade-off in the merge commit message.
3. **Resolve to existing behaviour only.** When no resolution fits without new behaviour, abort the merge (`git merge --abort`, leaving the worktree clean) and stop with why. Otherwise always finish the merge.
4. Run the type check and the tests that cover both sides before you finish, and fix what the merge broke.
5. Commit the merge (`git commit --no-edit`, or with the trade-off noted). Do not push.

## Process

1. See where you are: `git status`, which operation is in progress (rebase, merge, cherry-pick), and the list of conflicted files.
2. For each conflict, learn **the intent of both sides** before touching it:
   - the commits that touched those lines on each side (`git log -p --merge`, `git log <base>..<side> -- <file>`);
   - their messages, the spec and acceptance criteria they serve;
   - the tests each side added.
3. Write the resolution that does both things. Typical cases:
   - both added different things: keep both, in a sensible order;
   - one side refactored, the other changed behaviour: apply the behaviour change to the refactored code;
   - both changed the same behaviour differently: see Stop.
4. Check for semantic conflicts too: code that merged cleanly but now calls renamed functions, duplicates logic, or breaks the other side's tests.
5. Run the type check and the full test suite. Both sides' tests must pass.
6. Continue the operation (`git add`, then `git rebase --continue` / `git commit`) until it completes. Never use `--skip`, `-X ours/theirs`, or reset either side away.

## Stop when

- Keeping both intents would need behaviour that neither side has (a new rule, a product decision).
- The sides contradict each other and the spec does not say which wins.
- You cannot tell what one side meant.

Then leave the conflict unresolved, and state which files, what each side wants, and the decision needed.

## Finished when

No conflict markers remain, the in-progress operation completed, both sides' behaviour and tests survive, and the full suite passes.
