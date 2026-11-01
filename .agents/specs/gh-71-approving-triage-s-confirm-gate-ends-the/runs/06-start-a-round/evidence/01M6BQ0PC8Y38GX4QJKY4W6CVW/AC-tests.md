# Test runs on gh-71/06 HEAD (a2a66958e)

- `bun run test` (unit): 1019 pass, 0 fail — unit.log (includes golden.test rule cases round.start / round.reject / round.workflow_changed, decide.test AC12 stale mailbox tests at decide.test.ts:510, :519, :792, :805)
- `bun run typecheck`: clean — typecheck.log
- `bun test --config=bunfig.integration.toml human.test.ts runtime.test.ts`: 48 pass, 0 fail — human-runtime.log
- `bun run schema:emit && git diff --exit-code packages/schema/json`: clean — schema.log
- `bun run test:integration`: see integration.log
- `bun run test:e2e`: see e2e.log

Tests per criterion (packages/cli/test/integration/human.test.ts, describe at :598 unless noted):
- AC1, AC3, AC4, AC10: :728 "the next tick starts round 2 at refine in one action and one commit" (+ :668 counters at max, :690 manual round 1, handoff sections)
- AC2: :707 (only a round receipt, no state) + :728 (one action, one commit) + rule case round.start in packages/core/test/rule-cases.ts:143
- AC5: :787 open PR → same branch, body replaced, no second PR, merge ends story
- AC6, AC7: :764 same workflow again, --at; :690 unknown step refused
- AC8: :668 confirm gate refused round_unfinished with --force command
- AC9: :690 unknown_workflow; claim held elsewhere at describe :163 (mailbox clone)
- AC11: gh-8 B33 test at :508
- AC12: :707 hash changed (rule case round.workflow_changed), decide.test.ts:510/:519 stale mailbox, :835 flat $done migration
