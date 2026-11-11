---
id: gh-337/09
title: Approval carried over a clean base merge
depends_on: [ gh-337/07 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
A person who approved at `ready` is not asked again when only a clean base merge happened and test and CI are green; a merge that needed a resolution asks again and shows only what the resolver changed.

## Scope
User stories: approval carried after a clean merge with green test and CI; the carried approval in receipts and History; a resolved merge asks for a fresh approval; the ready item, brief and PR evidence show the remerge-diff; red test or CI never reaches ready carried. Seams: S1, S3. Out: regenerated merges counting as clean (13).

## Acceptance
- AC1 Given a story approved at `ready` whose only update outcomes since were `clean`, and whose test and CI then passed, when it reaches `ready`, then norn approves on its own with a receipt marked carried, and History shows "approval carried: clean base merge". — verifier: test
- AC2 Given any update since the last `ready` approve ended `resolved`, when the story reaches `ready`, then it waits for a person's approval. — verifier: test
- AC3 Given that fresh approval is asked after a resolution, then the `ready` inbox item, the brief and the PR evidence list the remerge-diff commands of the merges since the last approval. — verifier: test
- AC4 Given a clean base merge whose test or CI is red, then the story never reaches `ready` with a carried approval. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run schema:emit` (the approve receipt gains `carried`)

## Notes
D9.
