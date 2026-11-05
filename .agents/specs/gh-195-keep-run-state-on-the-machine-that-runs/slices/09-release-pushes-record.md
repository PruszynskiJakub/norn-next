---
id: gh-195/09
title: A claim release pushes the record first, or releases nothing
depends_on: [ gh-195/08 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
`norn story handoff`, a clean `watch` exit and `norn story close` push the story's branches and its record ref before the claim goes, under either policy; if the ref push fails, the claim stays and nothing is deleted.

## Scope
Behaviour: B15, B16, B33 (the release half), B11 (the release push under `local`). Seams: S1. Out: reading the record on the other machine (gh-195/10).

## Acceptance
- AC1 (B15, B11) Given gh-9 under `local` with no ref yet, when `norn story handoff gh-9` runs, then the remote has the story branch, the slice branches and `refs/norn/runs/gh-9` whose `Norn-Branch-Commit` is the pushed story branch head, the claim ref is deleted after them, and the reply says "handed over gh-9: record at <commit>, matches story branch <sha>". — verifier: test
- AC2 (B15) Given gh-9 held by a `watch` that exits cleanly, and given `norn story close gh-9`, when each releases the claim, then the ref is pushed before the claim is deleted. — verifier: test
- AC3 (B16) Given a `pre-receive` hook that rejects `refs/norn/runs/gh-9`, when `norn story handoff gh-9` runs, then it exits 3 with the reason and "check the remote, then run norn story handoff gh-9 again", the claim is still held and nothing is deleted; a `watch` exit in the same case keeps that claim and says so (T6a). — verifier: test
- AC4 (B33) Given a story with no branch, when it is handed over, then its ref is pushed with no `Norn-Branch-Commit` trailer and the claim is released. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
D4: releases call the store push synchronously and stop on failure. Prior art: the `team` and `story-take` tests' handoff across clones.
