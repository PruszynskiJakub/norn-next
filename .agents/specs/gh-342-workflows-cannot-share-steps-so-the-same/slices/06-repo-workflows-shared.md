---
id: gh-342/06
title: This repo's workflows rewritten with its own shared files
depends_on: [ gh-342/01, gh-342/04 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
This repo's `quick`, `story` and `release` take their common steps from this repo's own shared files, so a fix to this repo's CI wait or base update is made in one file, and they load to exactly today's workflows.

## Scope
User stories: this repo's `quick`/`story`/`release` rewritten with its own shared files, loading to today's. Seams: S3. Out: the bundled set (05).

## Acceptance
- AC1 Given the rewritten `.agents/workflows/` with its `shared/` files, when the repo process tests load them through the store's loader, then `quick`, `story` and `release` equal the `workflowHash` recorded by slice 01. — verifier: test
- AC2 Given the rewritten repo set, when the repo process tests search it, then `gh run watch` appears in exactly one file of the set (a shared file), and the other workflows in the folder still load without errors. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Plan D10 and Risks: `release`'s update and open-pr differ and may stay inline; the hash decides, but the CI wait must still be in one file. This edits `.agents/workflows/` only (the repo's ordinary files; running units keep their pins). Independent of 05: the two sets have their own shared files.
