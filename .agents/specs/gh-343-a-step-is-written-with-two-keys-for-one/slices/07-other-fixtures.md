---
id: gh-343/07
title: Move the remaining test fixtures to the new wording
depends_on: [gh-343/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Expand–contract migration batch: the workflow fixtures in the core, store, view and cli unit tests and the e2e tests (with their observe snapshots) that stand for a main checkout's files are in the new wording, so refusing the old wording there leaves them green.

## Scope
User stories: none new; keeps every tier green for the old-wording refusal. Seams: S1, S3, e2e transcripts and observe snapshots. Out: cli integration fixtures (slice 06); fixtures that are deliberately old wording (pins, branch files, translator input).

## Acceptance
- AC1 Given the unit tier and the e2e tier, when they run, then they pass, and no test writes an old-wording workflow into a main checkout except where the test is about the old wording. — verifier: test
- AC2 Given e2e transcripts and observe snapshots, when they change, then only the fixtures' wording moved, never an effect or a decision. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Pinned outputs change only for this intended fixture change; review each diff. The e2e tier runs in CI; `bun run test:e2e <file>` runs one file to rewrite its transcript. Golden cases were handled in slices 02 and 04.
