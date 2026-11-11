---
id: gh-337/11
title: Waiting stories are re-verified when the base moves
depends_on: [gh-337/04, gh-337/03, gh-337/05, gh-337/06, gh-337/08, gh-337/09, gh-337/10]
status: planned
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
When the base moves under a story waiting at `ready` or the merge step without a textual conflict, norn runs the workflow's chosen check on the merged tree locally, once per base move; red sends the story back through `update`.

## Scope
User stories: workflow key `base.verify`; shipped story and quick set it to their test step; invalid with `base.stale: behind` or a non-check step; verify on the merged tree in a temp worktree with no push, CI or approval; cached per (head, base); runs detached in a slot; red goes to update with the failure as `last_check` through a counter; green leaves the story waiting; no `base.verify` verifies nothing. Seams: S1, S3. Out: nothing else.

## Acceptance
- AC1 Given a workflow with `base.verify: <check step>`, then it validates; with `base.stale: behind`, or naming a step that is not a check, it is refused as invalid with the reason. The shipped story and quick workflows (both copies) set it to their test step. — verifier: test
- AC2 Given a story waiting at `ready` or the merge step whose base moved without a textual conflict, when the tick runs, then the verify check runs detached on the merged tree in a temporary worktree, taking a check slot, and pushes nothing, starts no CI and asks no approval. — verifier: test
- AC3 Given a verify run already recorded for the story's head and base sha, then no second run is ordered on later ticks; a new base sha orders a new one. — verifier: test
- AC4 Given no check slot is free, then no verify run is ordered until one is. — verifier: test
- AC5 Given the verify run is red, then the story takes its waiting step's `stale` edge to `update` through `stale_loop`, with the failure as `last_check` in the next brief; a counter at its max stops the loop. — verifier: test
- AC6 Given the verify run is green, then the story stays where it waits. — verifier: test
- AC7 Given a workflow without `base.verify`, then no verify run is ever ordered. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit` and `bun run docs:emit`

## Notes
D11. Depends on the merge step slice (it verifies at the merge step, and the spec puts re-verify after it), and on the last slices of changes 1–5 (03, 05, 06, 08, 09, 10), the order the person asked for. Verify reuses the `stale` edge; there is no new outcome. The cache is the check receipt's `verify: {head, base}`.
