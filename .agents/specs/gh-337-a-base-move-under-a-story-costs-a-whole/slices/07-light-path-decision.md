---
id: gh-337/07
title: The base update chooses the light path from git and receipts
depends_on: [gh-337/01]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
---

## Goal
`git: update` can end `clean` or `resolved` instead of `done` when, since the story was last approved, nothing but base merges and spec-folder bookkeeping happened, and the workflow routes those outcomes. A workflow that does not route them behaves as today.

## Scope
User stories: light path only for base merges and spec-folder-only commits (not `spec.md`) since the last approval; a ready reject or a ci fail into implement takes the full path; a changed `spec.md` takes the full path; the light path as update outcomes in the YAML; unrouted outcomes fall back to `done`; decided from git and receipts alone. Seams: S1, S3, S4. Out: the shipped route and the resolution review (08), the carried approval (09), regenerated merges counting as clean (13).

## Acceptance
- AC1 Given a workflow routing `clean` and `resolved` from `git: update`, and since the latest `approve` outcome in the round (review, resolution review or `ready`) only base merges and commits touching the story's spec folder other than `spec.md`, when the base merges with an empty remerge-diff on every merge since that approval, then the update ends `clean`; when any merge needed a resolution, it ends `resolved`. — verifier: test
- AC2 Given a story rejected at `ready`, or sent back by `ci` into implement, whose implement step committed code, when the next base update runs, then it ends `done` (the full path). — verifier: test
- AC3 Given a story whose `spec.md` changed since the last approval, when the base update runs, then it ends `done`. — verifier: test
- AC4 Given a workflow that does not route `clean` or `resolved`, when the base update runs under the light condition, then it ends `done` as today. — verifier: test
- AC5 Given the same receipts and the same git history on two machines, then the update outcome is the same; agent `done` receipts record the head they ended at, and the update's receipt records the git summary (per commit: parents, paths, trailers, remerge-diff paths) the choice was made from. — verifier: test
- AC6 The git port reports a merge commit's remerge-diff and the paths each commit in a range touches, proven by the git contract suite for the real adapter and the fakes; a git too old for remerge-diff makes the update end `done` or `resolved`, never `clean`. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit` (the done receipt gains `head_sha`)

## Notes
D7. Builds on the core outcome function from slice 01. Risk: a wrong anchor sends new work down the light path; AC2 and AC3 are the guard. The base side slice (10) also needs commits per path from git; whichever lands second reuses the other's operation.
