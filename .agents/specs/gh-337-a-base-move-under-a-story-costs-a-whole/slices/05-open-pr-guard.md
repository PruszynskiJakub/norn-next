---
id: gh-337/05
title: The PR head at merge is the commit CI ran on
depends_on: [ gh-337/03, gh-337/04 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
No change outside the spec folder reaches a gate or the merge step without going back through `open-pr`, so the head a person merges is always the commit `ci` watched pass.

## Scope
User stories: the PR's head at merge is the commit the `ci` step saw pass. Seams: S1, S3. Out: the push rule itself (03), the merge step itself (04).

## Acceptance
- AC1 Given a workflow where a path from an `open-pr` step reaches a gate or a merge step through an agent step or `git: update` without passing `open-pr` again, when it is validated, then it is refused as invalid with the reason; the shipped workflows validate. — verifier: test
- AC2 Given a story at a gate or the merge step whose local head changes a path outside its spec folder that the PR head lacks, then the story goes back to the workflow's `open-pr` step with a receipt saying the changes since open-pr are not on the PR; spec-folder-only differences stay local and the story keeps waiting. — verifier: test
- AC3 Given a story that passes `ci`, is approved at `ready` and waits at the merge step, then the PR's head on the remote is the commit `ci` watched: no story branch push happened after `ci` passed or `ready` approved. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D4. Observe reports the paths changed between the PR head and the local head.
