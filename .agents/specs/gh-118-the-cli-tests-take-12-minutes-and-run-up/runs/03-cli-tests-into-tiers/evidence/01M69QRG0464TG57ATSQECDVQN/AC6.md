# AC6 (B18) — person
- Renames: `git diff -M --name-status base...HEAD` on transcripts and observe snapshots: 8 files, all R100, 0 insertions/0 deletions.
- `bun run golden -- --update`: "0 of 93 golden case(s) decide differently now" (AC6-golden-update.log), git clean after.
- `bun run golden`: "9 golden case(s) added of 604 harvested" (AC6-golden-add.out). Added: agent.timeout.surface, remote.park, check.running/run, leases.reclaim, start.workflow_invalid, claim.renew/unit.rebase_in_progress, slices.slice_stuck/slice.done/unit.stuck, receipts.apply/agent.timeout.nudge, agent.attended.running. Removed again from the worktree.
- Same command on a fresh `git archive` of base gh-118-the-cli-tests-take-12-minutes-and-run-up: also 9 of 604, and the 9 file names are identical (diff empty).
So the letter of AC6 ("adds no case") fails on base too; the move itself changes no harvest. A person decides whether that meets AC6.
