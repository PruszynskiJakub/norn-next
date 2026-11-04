---
id: gh-195/05
title: Run state of new units lives in the machine dir
depends_on: [ gh-195/01, gh-195/04 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
---

## Goal
The tracer: a unit started on this build keeps its state, receipts, pinned workflow, logs and evidence at `<machine dir>/runs/<story>/<unit>/`, never in a worktree or on a branch, and a boundary commit carries only the agent's work and the handoff. Every test, golden case, transcript and snapshot that named a worktree `runs/` path is rewritten once here.

## Scope
Behaviour: B2, B3, B4, B5. Seams: S1, S2. Out: open stories that still have `runs/` on their branch (gh-195/06), the handoff's move to `handoffs/` and the prose-only handoff (gh-195/07; the handoff stays at its current path in the worktree for now and is committed as today), the ref and the policy (gh-195/08), how other machines see the story (gh-195/12), finished stories and `upgrade` (gh-195/16, gh-195/17).

## Acceptance
- AC1 (B2) Given gh-9 started on this build and running through implement and review, when `git status` runs in its worktree at any point, then no state, receipt, workflow, log or evidence file shows, and those files are under `<machine dir>/runs/gh-9/_story/` (and `<nn>-<slug>/` for a slice). — verifier: test
- AC2 (B2) Given gh-9 parked mid-step, when `git clean -fdx` runs in its worktree and then a tick, then the story is at the same step and attempt, with the same counters. — verifier: test
- AC3 (B3) Given gh-9 parked on an ask, when its story worktree is removed and `norn story start gh-9` recreates it, then `norn status` shows the same ask with the same attempt. — verifier: test
- AC4 (B4) Given a receipt file in the machine dir that fails schema validation, when a tick runs, then that unit is `corrupt` (S2) and the others are not. — verifier: test
- AC5 (B4) Given two slices running in parallel, when both report, then each writes only its own `<machine dir>/runs/<story>/<nn>-<slug>/` folder (S3); and given a crash between a receipt and `state.json` (including a tick taken while a detached check run is writing its receipt), the next tick re-applies the receipt (S6). — verifier: test
- AC6 (B5) Given an agent that reports `norn done done`, when the boundary commit lands, then it holds exactly the files the agent changed and the handoff, carries the S4 trailers (`Norn-Story`, `Norn-Step`, …), and holds no run-state file; the `uncommitted` fact counts only the agent's files and the handoff. — verifier: test
- AC7 (B2, B5) The golden corpus is rewritten with `bun run golden -- --update` (changes only in `UnitFacts.record` paths and commit path lists), the three effect transcripts and five observe snapshots are rewritten, and every tier is green. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run test:e2e`

## Notes
D1, D7 (snapshot reads run state from the machine dir; spec and frontmatter still from worktrees, base and main checkout), D8. Harvest golden cases for S12 with `bun run golden`.
Person's decision (slice gate 1): this slice covers new units only; a story begun under the old layout cannot run on this branch's build until gh-195/06 lands, which is acceptable because nothing releases in between.
Finished stories on the base branch still carry `runs/` in its tree until gh-195/16 and gh-195/17; whatever reads them today keeps doing so until gh-195/16 replaces it with the archive ref (D16: no fallback after that).
This is the slice the plan's blast-radius risk is about (about 35 test files, 56 golden cases, 3 transcripts, 5 snapshots).
