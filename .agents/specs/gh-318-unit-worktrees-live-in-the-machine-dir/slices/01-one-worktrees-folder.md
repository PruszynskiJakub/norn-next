---
id: gh-318/01
title: One place names the worktrees folder
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: agent }
---

## Goal
Every place that builds or recognises a unit worktree path takes the worktrees folder from one store function, and decide reads it from a fact, so moving the folder later is a one-line change. Nothing a person sees changes yet: the folder is still `<repo>-worktrees`.

## Scope
User stories: groundwork for every story about where worktrees are created and found (story and slice worktree paths, start commands, tidy, the gone-check, the view). Seams: S2 (decide through Facts). Out: moving the folder, the harness helper (slice 02), docs.

## Acceptance
- AC1 Given Facts whose repo reports a worktrees folder different from `<repo root>-worktrees`, when decide runs intake for a new story and starts a slice, then the story and slice worktree paths in its actions, and the start command and brief paths built from them, sit under the reported folder and not beside the repo root. — verifier: test
- AC2 Given the golden corpus with each case's repo reporting the old `<repo>-worktrees` folder as its worktrees folder, when the golden replay runs, then every case decides exactly as before (no decision changes). — verifier: test
- AC3 Given this slice's diff, when the sources of every package are searched for a hand-built `-worktrees` path, then the only one left is the single store function that names the folder; observe and the view fill the repo's worktrees fact from it. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
- Plan prefactor 1 and D1: core stays pure; the folder reaches decide as `Facts.repo.worktrees` (absolute path). Callers to route: decide's intake and slice start, `loadLocalFacts`, the story checkout, `unitStoryMode` (agent-unit), observe's orphan check, `inferUnitMarker`, `scanWorktrees`, `story start`'s gone-check.
- Adding `worktrees` to `Facts.repo` changes what observe reports; observe snapshots gain the field. That is an intended change; rewrite them with their update command and check the diff is that field only.
