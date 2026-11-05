---
id: gh-195/06
title: Open stories move their run state off the branch at the first tick
depends_on: [ gh-195/05 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
An open story that still has `runs/` on its branch from an older norn moves it into the holder's machine dir at the holder's first tick, removes it from the branch in one commit, and goes on at the same step and attempt.

## Scope
Behaviour: B34. Seams: S1. Out: the handoff's move in the same commit (gh-195/07), the ref push under `remote` (gh-195/08), finished stories on the base (gh-195/17).

## Acceptance
- AC1 (B34) Given gh-9 with `runs/` on its story branch from an older norn (built with the harness's layout helpers), when the holder's first tick runs, then its run state is in the machine dir, the branch gains one commit "norn: move gh-9 run state off the branch" that removes `runs/`, the branch is pushed, and the story continues at the same step and attempt with the same counters. — verifier: test
- AC2 (B34) Given a story with slices whose slice branches also carry `runs/<nn>-<slug>/`, when the holder ticks, then each unit's record lands in its own machine-dir folder and each branch loses its `runs/` in its own move commit. — verifier: test
- AC3 (B34, B4) Given a move interrupted after the copy (the machine dir holds the record, `runs/` still on the branch), when the next tick runs, then it only finishes the removal; and given a file in the branch's `runs/` that fails validation, the unit is `corrupt` and nothing is removed from the branch. — verifier: test
- AC4 (B34) Given a flat record (RD7) on the branch, when it moves, then it lands in `rounds/01-<wf>/` in the same step; and the golden corpus gains the `move_record` action (`golden --update` reviewed, `bun run golden` harvests its rule cases). — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D13 steps 1, 3 and 4 (step 2, the handoff move, is gh-195/07; the ref push under `remote` is gh-195/08). Observe reports `runs/` still on a held unit's branch; decide emits `move_record` per unit. Split from gh-195/05 by the person at the first slice gate. Plan risk: this repository migrates itself; run it on a copy of this repo before release.
