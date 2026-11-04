---
id: gh-195/04
title: Headless session logs move to the machine dir's sessions/
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
The headless runner writes `<run_id>.log` under the machine dir's `sessions/` instead of its `runs/`, freeing `runs/` for run state (S12). Old logs stay where they are for `tidy`.

## Scope
Behaviour: none of its own (prefactor 4, D1; enables B2). Seams: S1. Out: run state itself (gh-195/05).

## Acceptance
- AC1 (B2) Given a story run headless, when its session starts, then its log is written at `<machine dir>/sessions/<run_id>.log`, nothing is written under `<machine dir>/runs/`, and `run attach`/`run view` show the log as before. — verifier: test
- AC2 (B2) Given a machine dir with old logs in `runs/*.log` older than `trace.retain`, when `norn tidy` runs, then it lists and deletes them as it does other stale machine-local files, and leaves newer ones. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
Plan prefactor 4 and D1. The default lives in the headless adapter's options (`directory for <run_id>.log`); the path comes from store's paths. Keep the runner contract run green.
