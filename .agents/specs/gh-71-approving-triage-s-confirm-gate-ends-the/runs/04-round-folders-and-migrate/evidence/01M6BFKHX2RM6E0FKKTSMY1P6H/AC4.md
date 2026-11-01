# AC4 (B34): migrate guards and ordering — pass

CLI-level (sandbox):
- Not held: clone2 with its own NORN_HOME_DIR/NORN_MACHINE ticked (dev build) while checkout 1 held gh-12
  (flat, started by released norn): decisions had no round.migrate; origin branch unchanged (still flat).
- Rebase: in gh-12's worktree a `git rebase origin/main` stopped on a conflict; two dev ticks →
  `unit.rebase_in_progress` noop, record still flat. After `rebase --abort`, the next tick emitted round.migrate.
Decide unit tests (packages/core/test/unit/decide.test.ts "gh-71 D7 (B34)…", 4 pass): round.migrate before
a receipt, a remote park, a mirror and slices; not during rebase, not on claim.other, not once the PR merged;
not for a round record or record-less facts. Rule case `round.migrate` in packages/core/test/rule-cases.ts:135;
golden test passes (146 tests).
