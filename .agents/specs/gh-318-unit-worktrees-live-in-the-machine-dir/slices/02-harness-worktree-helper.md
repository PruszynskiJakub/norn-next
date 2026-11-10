---
id: gh-318/02
title: Tests name worktrees through the harness
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: agent }
---

## Goal
Integration and e2e tests, and the transcript harness's watched folders, name a unit worktree through one harness helper instead of spelling `${h.root}-worktrees/…`, so moving the folder touches one helper, not ~30 test files. Nothing norn does changes.

## Scope
User stories: groundwork for every story whose test checks where a worktree is (story and slice worktrees, start commands, tidy, the gone-check, the view, the second clone). Seams: S1 (the integration harness). Out: norn's own code (slice 01), moving the folder (slice 03).

## Acceptance
- AC1 Given the harness, when a test asks it for a unit worktree by its folder name (and the same for a second clone), then it gets the path norn creates that worktree at, and every existing integration and e2e test passes using it with its pinned transcripts unchanged. — verifier: test
- AC2 Given this slice's diff, when the integration tests, the e2e tests and the test support are searched for a hand-spelled `-worktrees` path, then none is left outside the helper (the transcript harness's watched clone folder included). — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
- Plan prefactor 2. The helper computes the old folder here (it cannot use slice 01's store function without depending on it); slice 03 points it at the store function.
- Herdr fixtures in the adapters' unit tests hold literal paths as recorded data: leave them, they test parsing, not where norn puts worktrees.
- The e2e tier runs in CI; run one e2e file locally only to confirm its transcript is unchanged.
