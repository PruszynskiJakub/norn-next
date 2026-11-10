## Goal

A `runs/` folder in a base or story branch's tree is ignored: no tick moves it, `norn status` and `norn doctor` say nothing about it, and decide has no rule for it. Run state is read only from the machine dir and archive refs.

## Proof

- Ticks leave a story branch's `runs/` alone; the story moves on from its machine-dir state (AC1): `packages/cli/test/integration/branch-tree-run-state.test.ts` › "ticks leave the branch tree as it is and the story moves on from its machine-dir state".
- `runs/` on the base: no status item or hint (AC2), no doctor run-state check in markdown or `--json` (AC3), nothing moved: `packages/cli/test/integration/archive-ref.test.ts` › "run list is empty for it, no status item or hint names it, and doctor has no run-state check in markdown or --json" (rewritten from the old D16/AC6 case, which asserted the opposite).
- Golden corpus (AC4): `bun run golden -- --update` reports "0 of 132 golden case(s) decide differently now"; only the four `run-state-move-*.json` cases are deleted, and the two `record.move`/`record.move_waits` rule cases are gone from `packages/core/test/rule-cases.ts`. No observe snapshot or transcript changed (unit tier green, nothing rewritten).
- `bun run test` (1722 pass) and `bun run typecheck` green.

## Easy to miss

- The integration tests above were written but **not run locally**: the brief keeps the integration tier for CI. They are red against the old code by construction (the old snapshot gave any unit whose worktree tree held `runs/` a `branch_record`, so decide emitted `record.move`, and doctor/status reported base `runs/`).
- `archiveBaseRunState` (store) and `norn upgrade`'s base archive move stay: they belong to slice 03. `upgrade-records.test.ts` lost only its doctor/status assertions (the item and the check no longer exist); its upgrade assertions are 03's to change.
- `checkout.ts` `lostRecord` no longer returns null when the branch holds `runs/`: a takeover with a lost record now restarts from the branch head, which is the accepted risk (a branch whose record lived only in its tree reads as having no record).

## Not proven yet

- The two integration tests have not run; CI's integration tier is the first run.

## Notes

- Removed: `branch_record`/`tree_root`/`BranchRecord` and `RunStateAt.tree` from the snapshot, `base_run_state` from snapshot, Facts and view, `baseRunStateStories`, `baseRunStateHint`, the base-run-state inbox item, the `move_record` action with its decide rule and act (`moveRecord`, `movePaths`), the `onBranch` exemption in marking a unit corrupt, observe's `branchRecord`, doctor's `run_state` check, store's `record-move.ts` (`copyTreeRecord`, `removeTreeRunState`, `moveTreeHandoffs`; `recordErrors` moved into `record-ref.ts`), the tree path helpers (`treeRunStateDir`, `treeRunStateFiles`, `treeUnitRunStateDir`, `treeHandoffFile`, schema's `treeRunStatePath`, `treeHandoffPath`), harness `toBranchRunState`, `run-state-move.test.ts`, and record-ref's moved-story case.
- View's `TraceRecords.source` narrowed to `"machine" | "archive"`: the `worktree`/`checkout` sources only came from branch-tree reads.
- `docs/recipes.md`: dropped the sentence that status and doctor point to `norn upgrade` until the base removal lands; the rest of that upgrade paragraph is 03's.
- Old traces holding a `move_record` decision stay readable (trace actions are free-form payloads; D12).

## Resume

Implementation done and committed; next is review of this slice against its four criteria.
