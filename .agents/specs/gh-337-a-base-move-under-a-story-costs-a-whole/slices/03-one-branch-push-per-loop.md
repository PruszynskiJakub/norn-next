---
id: gh-337/03
title: One branch push per loop once the PR is open
depends_on: [ gh-337/02 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
---

## Goal
Once a story's PR is open (a draft counts), norn pushes the story branch only at `open-pr` and at `story close`; every other boundary, the base update, approvals and claim release put the head on the heads ref instead. A rework loop starts exactly one CI run.

## Scope
User stories: no branch push at boundaries while the PR is open; `git: update` merges without pushing; open-pr pushes before creating or updating the PR; one CI run per rework loop; ready approving pushes nothing; handoff and clean watch exit put the latest boundary on the remote; story close pushes the branch first; a person's push merges with local boundaries. Seams: S1, S3, S5. Out: the merge step (04) and the open-pr guard (05).

## Acceptance
- AC1 Given a story whose PR is open or draft, when a step boundary commits (including a bookkeeping or empty boundary, and slice finishing onto the story branch), then the story branch on the remote does not move and the heads ref points at the new boundary. — verifier: test
- AC2 Given a story whose PR is open, when `git: update` merges the base, then the merge is local and on the heads ref only; the remote story branch does not move. — verifier: test
- AC3 Given a story whose PR is open, when `open-pr` runs, then it pushes the story branch before it creates or updates the PR, and the PR shows that head. — verifier: test
- AC4 Given a story whose PR is open, when `ready` approves, then nothing is pushed to the story branch. — verifier: test
- AC5 Given a story whose PR is open and a local boundary the branch lacks, when it is handed off with `norn story handoff` or released by a clean `norn watch` exit, then the heads ref holds the latest boundary and the story branch (the PR head) is unchanged; when it is closed with `norn story close`, the story branch is pushed first. — verifier: test
- AC6 Given a person pushed to the story branch while norn held unpushed boundaries, when norn next syncs, then both survive through a merge, never a rebase. — verifier: test
- AC7 Given the recorded base-sync flow, when one rework loop runs with the PR open (implement → … → open-pr → ci), then the transcript shows exactly one push of the story branch, at open-pr. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `NORN_TRANSCRIPT_UPDATE=1 bun run test:e2e test/e2e/base-sync.test.ts` (review the transcript diff as the intended change)

## Notes
D1 ("PR open" is `pr ?? pr_seen` with state open), D3. Claim release goes through the push path slice 01 made. The golden diff for `commit.push` is the proof.
