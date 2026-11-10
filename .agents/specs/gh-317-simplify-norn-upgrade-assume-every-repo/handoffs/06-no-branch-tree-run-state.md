## Goal

A `runs/` folder in a base or story branch's tree is ignored: no tick moves it, `norn status` and `norn doctor` say nothing about it, and decide has no rule for it. Run state is read only from the machine dir and archive refs.

## Proof

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | a story branch's tree holds `runs/` and its run state is in the machine dir: ticks never change the branch tree, and the story moves on from its machine-dir state | test | `packages/cli/test/integration/branch-tree-run-state.test.ts` › "ticks leave the branch tree as it is and the story moves on from its machine-dir state" (passed locally in review) |
| AC2 | the base branch's tree holds `runs/`: no `norn status` item or hint mentions base-tree run state | test | `packages/cli/test/integration/archive-ref.test.ts` › "run list is empty for it, no status item or hint names it, and doctor has no run-state check in markdown or --json" (passed locally in review) |
| AC3 | the same repo: `norn doctor` (markdown and `--json`) has no run-state section or key | test | same archive-ref test: no `run_state` key in `repo`, no "run state" line in the markdown |
| AC4 | golden corpus: only the four record-move cases and their rule cases are gone; every other case decides as before; observe snapshots and effect transcripts are unchanged | test | golden: `packages/core/test/unit/golden.test.ts`; `bun run golden -- --update` → "0 of 132 … decide differently"; observe snapshots: `test/e2e/observe-snapshots.test.ts` passes; **effect transcript: `test/e2e/recovery.test.ts` fails** (review F1) |
| User story 21 | `runs/` in a base or branch tree is never read, moved or warned about | test | AC1–AC3 above |

- `bun run test` (1722 pass) and `bun run typecheck` are green.

## Easy to miss

- Effect transcripts run in the **e2e** tier, not the unit tier. Dropping the branch-tree `runs/` check from `checkout.ts` `lostRecord` removed one spawn (`git cat-file -e <sha>:<spec>/runs`) from `test/e2e/recovery.test.ts`'s transcript, so that test is now red.
- `archiveBaseRunState` (store) and `norn upgrade`'s base archive move stay: they belong to slice 03. `upgrade-records.test.ts` lost only its doctor/status assertions; changing its upgrade assertions is 03's job.
- `lostRecord` no longer returns null when the branch holds `runs/`. A takeover with a lost record now restarts from the branch head. This is the accepted risk: a branch whose record lived only in its tree reads as having no record.

## Not proven yet

- AC4's effect-transcript part: `test/e2e/recovery.test.ts` › "a claim lost mid-run > effect transcript" is red until the transcript is rewritten and the change is explained (review F1).

## Notes

- Review #1: changes requested. 1 blocking finding:
  - F1: the recovery effect transcript is red after the `lostRecord` change.
  - Minor, not rework: F2, a stale comment "Run state an older norn left on the base, pointed to `norn upgrade`" at `packages/cli/src/runtime/observe/index.ts:522` and `packages/view/src/load.ts:474`. F3, `docs/limitations.md:29` still mentions the move off the branch, and `docs/concepts.md:101` still says status and doctor point to `norn upgrade`.
- Removed: `branch_record`/`tree_root`/`BranchRecord` and `RunStateAt.tree` from the snapshot; `base_run_state` from snapshot, Facts and view; `baseRunStateStories`, `baseRunStateHint` and the base-run-state inbox item; the `move_record` action with its decide rule and act; the `onBranch` exemption in marking a unit corrupt; observe's `branchRecord`; doctor's `run_state` check; store's `record-move.ts` (`recordErrors` moved into `record-ref.ts`); the tree path helpers; harness `toBranchRunState`; `run-state-move.test.ts`.
- View's `TraceRecords.source` is narrowed to `"machine" | "archive"`.
- Old traces holding a `move_record` decision stay readable (D12).

## Resume

Run `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e test/e2e/recovery.test.ts` and check that the transcript diff is only the removed `git cat-file -e …/runs` spawn. Record that change under Proof for AC4, then run `bun run test:e2e`, `bun run test` and `bun run typecheck`.
