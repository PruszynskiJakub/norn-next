---
id: gh-337/02
title: Heads ref at every boundary; takeover resumes from it
depends_on: [gh-337/01]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: agent }
---

## Goal
Every boundary also puts the story's head on `refs/norn/heads/<story>`, under both record policies, so the story's real last boundary is always on the remote without being a branch push. Takeover and the record push use it. Before the PR is open nothing else changes.

## Scope
User stories: no PR yet, boundaries push as today; `record.policy: remote` keeps working; takeover resumes from the real last boundary, with the limitations note; the push rule has no setting. Seams: S1, S3. Out: stopping branch pushes once the PR is open (slice 03).

## Acceptance
- AC1 Given a story with no PR yet, when a step boundary commits, then the story branch is pushed exactly as today and `refs/norn/heads/<story>` on the remote points at the same commit, in one push. — verifier: test
- AC2 Given `record.policy: remote`, when a boundary is recorded, then the record ref is pushed as today and its record names the heads ref commit (`Norn-Branch-Commit`), so another machine reads the story's state. — verifier: test
- AC3 Given the machine holding a story crashed after a boundary the remote branch lacks, when another machine takes the story over, then it resumes from the heads ref merged with the remote branch (never rebased), under both record policies. — verifier: test
- AC4 Given a story ends (merged-PR cleanup or `norn story close`) or `norn tidy` runs, then the story's heads ref is removed from the remote; and no config key turns the push rule off. — verifier: test
- AC5 `docs/limitations.md` says that under `record.policy: local` a crash still loses the receipts and counters since the last record push, and the step restarts at that boundary with fresh counters. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run golden -- --update` (review the diff: the push flag on boundaries)

## Notes
D2. The ref name goes in `ids.ts` beside the other prefixes; fetched per story, never `refs/norn/*`. The golden diff will be large; read it as the proof (Risks › push rule breadth).
