---
id: gh-195/02
title: Give a unit's handoff its own resolver
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
A unit's handoff path comes from its own resolver, keyed by the unit, not derived from its record folder. Its location stays where it is today, so nothing changes for a person; gh-195/07 then moves it without touching record readers.

## Scope
Behaviour: none of its own (prefactor 2; enables B6, B8, B39). Seams: S1, S2. Out: the move to `handoffs/` (gh-195/07), run-state paths (gh-195/01).

## Acceptance
- AC1 (B39) Given the tree as it is before this slice, when every tier runs after it, then every test passes unchanged, the golden corpus replays with no `--update`, and the transcripts and observe snapshots are byte-identical. — verifier: test
- AC2 (B6, B39) `brief`, `story checkout`, the boundary commit and the session start find the handoff through the new resolver only: no package source derives a handoff path from a record folder (`dirname` of a record path, `recordPaths`), checked by a repo lint or a unit test over the sources. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`
- `bun run test:e2e`

## Notes
Plan prefactor 2. Today `handoffPath(ud)` and `recordPaths(ud)` in store's paths sit on the record folder (gh-71 B31: the story's above its round folders). Runs in parallel with gh-195/01; both touch paths.ts, so whichever lands second merges.
