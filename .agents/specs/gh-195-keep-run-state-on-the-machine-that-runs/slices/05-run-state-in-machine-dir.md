---
id: gh-195/05
title: Run state lives in the machine dir; open stories move there at the first tick
depends_on: [gh-195/01, gh-195/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
---

## Goal
The tracer: a story's state, receipts, pinned workflow, logs and evidence live at `<machine dir>/runs/<story>/<unit>/` and never in a worktree or on a branch; a boundary commit carries only the agent's work and the handoff; an open story that still has `runs/` on its branch moves off it at the holder's first tick and goes on where it was. Every test, golden case, transcript and snapshot that named a worktree `runs/` path is rewritten once here.

## Scope
Behaviour: B2, B3, B4, B5, B34. Seams: S1, S2. Out: the handoff's move to `handoffs/` and the prose-only handoff (gh-195/07; the handoff stays at its current path in the worktree for now and is committed as today), the ref and the policy (gh-195/08), how other machines see the story (gh-195/12), the base branch's record and `upgrade` (gh-195/16, gh-195/17).

## Acceptance
- AC1 (B2) Given gh-9 running through implement and review, when `git status` runs in its worktree at any point, then no state, receipt, workflow, log or evidence file shows, and those files are under `<machine dir>/runs/gh-9/_story/` (and `<nn>-<slug>/` for a slice). — verifier: test
- AC2 (B2) Given gh-9 parked mid-step, when `git clean -fdx` runs in its worktree and then a tick, then the story is at the same step and attempt, with the same counters. — verifier: test
- AC3 (B3) Given gh-9 parked on an ask, when its story worktree is removed and `norn story start gh-9` recreates it, then `norn status` shows the same ask with the same attempt. — verifier: test
- AC4 (B4) Given a receipt file in the machine dir that fails schema validation, when a tick runs, then that unit is `corrupt` (S2) and the others are not. — verifier: test
- AC5 (B4) Given two slices running in parallel, when both report, then each writes only its own `<machine dir>/runs/<story>/<nn>-<slug>/` folder (S3); and given a crash between a receipt and `state.json` (including a pack or tick taken while a detached check run is writing its receipt), the next tick re-applies the receipt (S6). — verifier: test
- AC6 (B5) Given an agent that reports `norn done done`, when the boundary commit lands, then it holds exactly the files the agent changed and the handoff, carries the S4 trailers (`Norn-Story`, `Norn-Step`, …), and holds no run-state file; the `uncommitted` fact counts only the agent's files and the handoff. — verifier: test
- AC7 (B34) Given gh-9 with `runs/` on its story branch from an older norn (built with the harness's layout helpers), when the holder's first tick runs, then its run state is in the machine dir, the branch gains one commit "norn: move gh-9 run state off the branch" that removes `runs/`, the branch is pushed, and the story continues at the same step and attempt. — verifier: test
- AC8 (B34) Given a migration interrupted after the copy (the machine dir holds the record, `runs/` still on the branch), when the next tick runs, then it only finishes the removal; and a flat record (RD7) lands in `rounds/01-<wf>/` in the same move. — verifier: test
- AC9 (B2, B5) The golden corpus is rewritten with `bun run golden -- --update` (changes only in `UnitFacts.record` paths, commit path lists and the new `move_record` action), the three effect transcripts and five observe snapshots are rewritten, and every tier is green. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run test:e2e`

## Notes
D1, D7 (snapshot reads run state from the machine dir; spec and frontmatter still from worktrees, base and main checkout), D8, D13 (steps 1, 3, 4; step 2, the handoff move, comes with gh-195/07; the ref push under `remote` comes with gh-195/08). New action `move_record`; harvest golden cases for S12 with `bun run golden`.
Finished stories on the base branch still carry `runs/` in its tree until gh-195/16 and gh-195/17; readers of a finished story keep reading the base tree in this slice.
This is the slice the plan's blast-radius risk is about (about 35 test files, 56 golden cases, 3 transcripts, 5 snapshots). If it does not fit one session, the person's call is to split the open-story migration (AC7, AC8) into its own slice after this one; until then a story begun under the old layout cannot run on this branch's build, which is acceptable only because nothing releases in between.
