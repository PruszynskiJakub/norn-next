---
id: gh-317/06
title: Run state is read only from the machine dir and archive refs
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
A `runs/` folder left in a base branch's or a story branch's tree is ignored: no tick moves it, `norn status` raises nothing about it, doctor reports no run-state section, and decide has no rule for it.

## Scope
User stories: `runs/` in a base or branch tree never read, moved or warned about. Seams: S1. Out: upgrade's archive-ref move of base-tree run state (03).

## Acceptance
- AC1 Given an open story whose branch tree holds `runs/` and whose run state is in the machine dir, when ticks run, then the branch tree is never changed (no commit removes `runs/`), and the story moves on from its machine-dir state. — verifier: test
- AC2 Given a base branch whose tree holds `runs/`, when `norn status` runs, then no item or hint mentions base-tree run state. — verifier: test
- AC3 Given such a repo, when `norn doctor` runs (markdown and `--json`), then there is no run-state section or key. — verifier: test
- AC4 Given the golden corpus, when it runs, then only the four record-move cases and their rule cases are gone and every other case decides as before; observe snapshots and effect transcripts are unchanged. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D10, D12. Remove `branch_record`/`tree_root` and `base_run_state` from the types first and let `tsc` find every reader (snapshot, observe, decide, act, view). Also goes: `baseRunStateStories`, the `move_record` action with its decide rule and act, the `onBranch` exemption in marking a unit corrupt, the base-run-state inbox item and hint, `run-state-move.test.ts`, `toBranchRunState`. Regenerate with `bun run golden -- --update` and read the diff: any change beyond the removed cases is a finding. Old traces holding a `move_record` decision stay readable (D12). The store's `archiveBaseRunState` is upgrade's and goes in 03. Accepted risk: a story branch whose record existed only in its tree now reads as having no record.
