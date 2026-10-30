$ norn status
gh-7 Add login form
  story · manual · mine · ready slices#1 33s [base_conflict_loop 0/2, plan_loop 0/3, qa_loop 0/2, ready_loop 0/2, stale_loop 0/10, test_loop 0/5]
  → norn brief
  base main: 1 behind
  gh-7/01    form — running review#1 0s [conflict_loop 0/2, review_loop 0/3, test_loop 0/5]

gh-9 Fix typo
  quick · manual · mine · ready implement#1 1m
  → cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'
  base main: 1 behind

Runs
  gh-7/01    review#1 auto claude alive since 2026-10-28T17:40:37.474Z

heartbeat: last tick 0s ago on jakubpruszynski@mac
1 item needs you — norn inbox
[exit 0]

$ norn story start gh-7/01 --print
{"error":"gh-7/01 review: nothing for a person to start — it is running","do_instead":"norn inbox","code":"nothing_to_open"}
[exit 3]

Printed command:
undefined

Pasted into a fresh zsh (claude = stub that echoes its args, then runs norn brief):
zsh:1: command not found: undefined
[exit 127]

(gh-7/01 had been launched in auto; using gh-9, manual, ready at implement)
$ norn story start gh-9 --print
{"unit":"gh-9","step":"implement","worktree":"/private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo","command":"cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'","opened":false}
[exit 0]

Printed command:
cd /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo && claude --permission-mode auto -- 'Use the norn skill, then run `norn brief`.'

Pasted into a fresh zsh from / (claude = stub that echoes its args, then runs norn brief):
stub claude in /private/var/folders/rb/k1spzrcd5lx7cb_bkzqw529h0000gn/T/qa-gh75-08/w/repo-worktrees/gh-9-fix-typo with args:
  [--permission-mode]
  [auto]
  [--]
  [Use the norn skill, then run `norn brief`.]
--- running: norn brief (dev build) ---
# norn brief — gh-9 · implement #1

## Where you are

- Story: gh-9
- Step: implement (attempt 1)
- Mode: manual
- Run: 01M61SKFA7AZKHVM94CPEVYB3Y

## Why this attempt

A previous session of this attempt ended without reporting (`implement.died`: process gone, no receipt). This is a fresh session: nothing it did counts as reported. Look at `git status`, `git log` and the handoff's Progress for partial work, then finish the step.

## Your work

Use the `norn-implement` skill.

## Inputs

- Story spec: `.agents/specs/gh-9-fix-typo/story.md`
[exit 0]
