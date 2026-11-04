---
id: gh-195/01
title: Resolve run state by checkout, story and unit
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Every reader and writer of run state finds a unit's folder by asking one resolver for `(checkout, story, unit)` instead of joining a worktree path with a spec folder itself. Nothing a person sees changes; the move to the machine dir (gh-195/05) then changes one function.

## Scope
Behaviour: none of its own (prefactor 1; enables B2–B4, B34). Seams: S1, S2. Out: moving the folder, the handoff's location (gh-195/02).

## Acceptance
- AC1 (B4) Given the tree as it is before this slice, when the unit, integration and e2e tiers run after it, then every test passes unchanged, the golden corpus replays with no `--update`, and the effect transcripts and observe snapshots are byte-identical. — verifier: test
- AC2 (B2, B4) A repo lint (or a unit test over the sources) fails when a package source outside the resolver's module builds a unit's run-state path by joining a spec folder with `runs/`, and passes on the tree as shipped. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run test:e2e`

## Notes
Plan prefactor 1. Today `unitDir(specDir, unit)` and friends in store's paths take a spec folder, and each caller picks its own worktree (about thirty call sites across store, view and cli). Keep the folder exactly where it is. AC2 is what keeps new callers from bypassing the resolver once the location moves.
