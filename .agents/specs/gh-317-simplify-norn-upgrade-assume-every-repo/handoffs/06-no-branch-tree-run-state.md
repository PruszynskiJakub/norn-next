## Goal

A `runs/` folder in a base or story branch's tree is ignored: no tick moves it, `norn status` and `norn doctor` say nothing about it, and decide has no rule for it. Run state is read only from the machine dir and archive refs.

## Proof

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a story branch's tree holds `runs/` and its run state is in the machine dir: ticks never change the branch tree, and the story moves on from its machine-dir state | test | `packages/cli/test/integration/branch-tree-run-state.test.ts` › "ticks leave the branch tree as it is and the story moves on from its machine-dir state" (passed in review #2) |
| AC2 | the base branch's tree holds `runs/`: no `norn status` item or hint mentions base-tree run state | test | `packages/cli/test/integration/archive-ref.test.ts` › "run list is empty for it, no status item or hint names it, and doctor has no run-state check in markdown or --json" (passed in review #2) |
| AC3 | the same repo: `norn doctor` (markdown and `--json`) has no run-state section or key | test | same archive-ref test: no `run_state` key in `repo`, no "run state" line in the markdown |
| AC4 | golden corpus: only the four record-move cases and their rule cases are gone; every other case decides as before; observe snapshots and effect transcripts are unchanged | test | golden: `packages/core/test/unit/golden.test.ts` (unit tier, green in review #2; only the four `run-state-move-*.json` cases deleted); `bun run golden -- --update` → "0 of 132 … decide differently"; observe snapshots: `test/e2e/observe-snapshots.test.ts` passes unchanged; effect transcripts: `test/e2e/recovery.test.ts` passes (re-run in review #2) after one intended rewrite of `test/e2e/transcripts/recovery-claim-lost.txt` (see below); every other transcript is unchanged |
| User story 21 | `runs/` in a base or branch tree is never read, moved or warned about | test | AC1–AC3 above |

- The one transcript change: `recovery-claim-lost.txt` loses `spawn repo-b $ git cat-file -e <sha:4>:.agents/specs/gh-9-add-search/runs`, and nothing else. That spawn was `lostRecord`'s check for `runs/` in the branch tree, which this slice removes (user story 21: a branch tree's `runs/` is never read).
- `bun run test`, `bun run typecheck` and the whole e2e tier (`bun run test:e2e`, 74 pass) are green.

## Easy to miss

- Effect transcripts run in the **e2e** tier, not the unit tier: a change to which git commands a tick spawns shows up only under `bun run test:e2e`.
- `archiveBaseRunState` (store) and `norn upgrade`'s base archive move stay: they belong to slice 03. `upgrade-records.test.ts` lost only its doctor/status assertions; changing its upgrade assertions is 03's job.
- `lostRecord` no longer returns null when the branch holds `runs/`. A takeover with a lost record now restarts from the branch head. This is the accepted risk: a branch whose record lived only in its tree reads as having no record.

## Not proven yet

- Nothing for this slice.

## Notes

- Review #2 approved. Review #1's blocking finding (the recovery effect transcript was red after the `lostRecord` change) is fixed: the only transcript diff is the removed `git cat-file -e …/runs` spawn.
- Minor, for the person: `packages/core/test/rule-cases.ts:153` keeps the comment "A held story whose record is still flat moves into round 1 first", which introduced the removed `record.move` case and now sits orphaned above the `record.push` case.
- Review #1 minor notes, left as notes: F2, a stale comment "Run state an older norn left on the base, pointed to `norn upgrade`" at `packages/cli/src/runtime/observe/index.ts:522` and `packages/view/src/load.ts:474`. F3, `docs/limitations.md:29` still mentions the move off the branch, and `docs/concepts.md:101` still says status and doctor point to `norn upgrade`.
- Removed: `branch_record`/`tree_root`/`BranchRecord` and `RunStateAt.tree` from the snapshot; `base_run_state` from snapshot, Facts and view; `baseRunStateStories`, `baseRunStateHint` and the base-run-state inbox item; the `move_record` action with its decide rule and act; the `onBranch` exemption in marking a unit corrupt; observe's `branchRecord`; doctor's `run_state` check; store's `record-move.ts` (`recordErrors` moved into `record-ref.ts`); the tree path helpers; harness `toBranchRunState`; `run-state-move.test.ts`.
- View's `TraceRecords.source` is narrowed to `"machine" | "archive"`.
- Old traces holding a `move_record` decision stay readable (D12).

## Resume

Next is whatever the workflow sends after review approve; nothing is owed for this slice.
