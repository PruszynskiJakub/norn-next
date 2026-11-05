## repo tests by name
 24 pass
 0 fail
## bun run golden -- --update (from repo root)
$ bun scripts/golden.ts --update

0 of 93 golden case(s) decide differently now; only their decisions were rewritten
## git status after
10:test("stableKey ignores what differs between two runs of one tick and keeps which ids are equal", () => {
22:test("a case is named by decide's inputs, so new decisions (golden.ts --update) keep its name", () => {
31:test("every committed golden case is named by its stable key", () => {
41:test("selectNew adds only new keys that bring an under-covered rule, smallest first, whatever the input order", () => {
52:test("decisionChanges lists the decisions that went and came, not those only reordered", () => {
61:test("the harvest finds the harness test files in cli integration and test/e2e and runs each with its tier's config (gh-118 B19)", () => {
## bun run golden (harvest, from repo root)
added housekeeping-179f36b22a7d.json: start.workflow_invalid
added rebase-rewind-0a4c2f7ca16d.json: claim.renew, unit.rebase_in_progress
added story-reopen-a1feef443f31.json: slices.slice_stuck, slice.done, unit.stuck
added run-rerun-cancel-c4951d9aea19.json: receipts.apply, agent.timeout.nudge
added status-watch-bf9ed6a217f0.json: receipts.apply, agent.attended.running
added agent-protocol-aebc90a877f3.json: agent.timeout.surface

9 golden case(s) added of 604 harvested; the 93 existing left as they were → packages/core/test/golden
bun run golden 2>&1  350.09s user 381.83s system 371% cpu 3:17.07 total
tail -8  0.00s user 0.00s system 0% cpu 3:17.07 total
## git status after
?? packages/core/test/golden/agent-protocol-aebc90a877f3.json
?? packages/core/test/golden/base-sync-3840c46a2ba5.json
?? packages/core/test/golden/check-run-0bb8618bb933.json
?? packages/core/test/golden/check-run-79e9bb3eaf13.json
?? packages/core/test/golden/housekeeping-179f36b22a7d.json
?? packages/core/test/golden/rebase-rewind-0a4c2f7ca16d.json
?? packages/core/test/golden/run-rerun-cancel-c4951d9aea19.json
?? packages/core/test/golden/status-watch-bf9ed6a217f0.json
?? packages/core/test/golden/story-reopen-a1feef443f31.json
(the 9 harvested cases were QA byproducts and were deleted; worktree clean)
