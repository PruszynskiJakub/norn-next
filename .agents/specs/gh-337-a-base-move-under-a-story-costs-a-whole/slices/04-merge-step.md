---
id: gh-337/04
title: A merge step keeps an approved story in its workflow
depends_on: [ gh-337/01 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: agent }
---

## Goal
A new step type `merge` follows `ready` in the shipped story, quick and release workflows. An approved story waits there for its PR to merge, shows today's merge item, finishes when the PR merges, and goes back to `update` on its own when the base moves under it in a stale way.

## Scope
User stories: step type `merge`; shipped story and quick route ready approve to merge; one merge item, no gate item; merging ends the story as today; a closed PR behaves as today; a stale base move goes back to update through a counter; nothing to approve or reject; workflows without a merge step unchanged; `story update-branch` keeps working; merge step documented. Seams: S1, S3. Out: the open-pr guard for merge steps (05), re-verify at the merge step (11).

## Acceptance
- AC1 Given a workflow with a step of `type: merge`, then it validates, and its only outcome is `stale`; a workflow giving it other outcomes is refused as invalid with the reason. — verifier: test
- AC2 Given the shipped story and quick workflows (both copies) and `release.yaml`, when `ready` approves, then the story moves to the merge step instead of finishing the round. — verifier: test
- AC3 Given a story waiting at the merge step, then the inbox shows exactly one item for it: today's merge item ("Merge PR #N", the PR URL, the draft note, how far behind its base it is, the merge command), and no gate item. — verifier: test
- AC4 Given a story waiting at the merge step, when its PR merges, then the story finishes through today's merged-PR path; when its PR is closed unmerged, it behaves as a story with a closed PR does today. — verifier: test
- AC5 Given a story waiting at the merge step, when the base moves in a way its workflow counts as stale (and the PR was fetched this tick), then the story goes to `update` through the `stale_loop` counter; a squash-merged PR is never read as a base move, and a counter at its max stops the loop. — verifier: test
- AC6 Given a story waiting at the merge step, when a person runs `norn approve` or `norn reject` on it, then it is refused. — verifier: test
- AC7 Given a workflow with no merge step, when `ready` approves, then the round finishes and a conflicting finished story shows today's merge item with `norn story update-branch`; the existing golden cases stay unchanged. — verifier: test
- AC8 Given a story waiting at the merge step (or a stuck story), when a person runs `norn story update-branch`, then the base is brought in as today. — verifier: test
- AC9 The workflow reference and `docs/concepts.md` document the merge step type beside the other step types, and the base-sync recipe mentions it. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit` and `bun run docs:emit` (after the schema and workflow changes)

## Notes
D5. Risk: code keyed on a finished round (`roundFinished`, `storyPhase`, the inbox, update-branch's wait check) must treat a merge-step wait as waiting for the merge; cover each at S1. In release.yaml: `stale: behind` → update → prepare rewrites the changelog; no `base.verify`. Change shipped workflows in both copies.
