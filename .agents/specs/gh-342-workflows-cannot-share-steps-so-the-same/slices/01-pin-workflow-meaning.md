---
id: gh-342/01
title: Pin today's meaning of every workflow the story rewrites
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Before any workflow file is rewritten, the tests record what the bundled `quick`/`story` and this repo's `quick`/`story`/`release` mean today, so a later rewrite that changes a route, counter or instruction goes red.

## Scope
User stories: groundwork for the bundled workflows loading to today's workflows and for this repo's workflows loading to today's (prefactor 1). Seams: S3. Out: rewriting any workflow (slices 05 and 06), shared files.

## Acceptance
- AC1 Given the bundled workflow templates, when the asset tests load them, then they load through the store's workflow loader (not their own YAML parse) and bundled `quick` and `story` each equal the `workflowHash` recorded on this base, with 29 routes / 8 counters and 42 routes / 10 counters. — verifier: test
- AC2 Given this repo's workflows, when the repo process tests load them, then they load through the store's workflow loader and `quick`, `story` and `release` each equal the `workflowHash` recorded on this base. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Green on arrival: no workflow file changes here. Take the hashes from the loader on this base, never by hand. Plan: Prefactoring 1, Testing decisions (equivalence pinned by `workflowHash`).
