---
id: gh-110/06
title: norn migrate moves a repo to the new layout
depends_on: [ gh-110/05 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: agent }
---

## Goal
A person on the old layout runs `norn migrate` in the main checkout: config and workflows are moved as staged git renames, the trace, heartbeat and locks move to the machine dir, norn's old `.gitignore` line goes, and nothing is committed. It refuses safely when it must, and does nothing on a migrated repo.

## Scope
Behaviour: B11, B12, B13, B14, B15, B16, B17 (for `migrate`). Seams: S1. Out: docs and `help` text beyond the command's own entry (slice 07).

## Acceptance
- AC1 (B11) Given `.agents/norn/config.yaml` and `.agents/norn/workflows/{story,quick}.yaml`, when `norn migrate` runs, then `git status` shows them renamed to `.agents/norn.config.yaml` and `.agents/workflows/{story,quick}.yaml`, staged, no commit made; the output lists each move and ends with the commit to make; `--json` gives `{moves, staged, commit}`. — verifier: test
- AC2 (B12) Given `.agents/norn/trace/heartbeat.json` with heartbeat id H and a claim held by this checkout, when `norn migrate` runs and then a tick, then the machine dir's `heartbeat.json` holds H, the tick recognises its own claim (ID2), and `.agents/norn/` no longer exists. — verifier: test
- AC3 (B13) Given `.gitignore` with norn's `.agents/norn/trace/` line and the person's own lines, when `norn migrate` runs, then that line is gone, `.gitignore` is staged, and the person's lines are untouched. — verifier: test
- AC4 (B14) Given a migrated repo, when `norn migrate` runs again, then it says "nothing to move", exits 0, and `git status` is unchanged. — verifier: test
- AC5 (B15) Given the tick lock held the way `watch` holds it, when `norn migrate` runs, then it refuses (exit 3) with `do_instead` to stop `watch` and run it again, and nothing is moved. — verifier: test
- AC6 (B16) Given a unit worktree, when `norn migrate` runs there, then it refuses (exit 3) with `do_instead` naming the main checkout's path, and nothing is moved anywhere. — verifier: test
- AC7 (B17) Given one part in both its old and new place, when `norn migrate` runs, then it refuses (exit 3) naming both paths and moves nothing. — verifier: test
- AC8 (B11, B12) Given a migration interrupted after the config and workflows moved but before the trace did (old trace dir still there), when `norn migrate` runs again, then it finishes the move; an untracked old workflow file is moved plainly and listed as untracked. — verifier: test
- AC9 (B11, B12, B13) In a throwaway repo initialised on the old layout (moved back by hand, with a trace from a few ticks), run `norn migrate`, read the output and `git status`, commit, and run `norn status` successfully. — verifier: agent

## Checks
- `bun test packages/cli`
- `bun run typecheck`

## Notes
D6: checks first (main checkout, both layouts, tick lock), then every step under the tick lock taken at its old place, each rerunnable; the old lock file goes last; no rollback; cross-filesystem move is copy then delete (Risks; no test of its own). `migrate` is a person's command: markdown by default, `--json` for data (Decisions). Add it to `norn help` with one line here; the docs follow in slice 07.
