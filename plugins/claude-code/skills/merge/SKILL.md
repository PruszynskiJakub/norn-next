---
name: merge
description: Resolve git merge or rebase conflicts by understanding the intent of both sides and keeping both, then prove it with the tests; stop when a resolution would need new behaviour. Use when a rebase, merge or cherry-pick stopped on conflicts.
---

# Merge

Resolve conflicts so that both sides' intended behaviour survives. You are combining work, not choosing a winner.

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
