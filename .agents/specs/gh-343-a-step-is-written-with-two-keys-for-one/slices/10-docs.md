---
id: gh-343/10
title: Docs teach the new wording
depends_on: [gh-343/05]
status: planned
criteria:
  - { id: AC1, verifier: agent }
  - { id: AC2, verifier: test }
---

## Goal
A reader of the concepts page, the recipes (writing your own workflow, naming your own skill in a step) and the generated reference sees only the new wording, including the `norn upgrade` path for old files.

## Scope
User stories: the docs show the new wording. Seams: none (review and the docs emit). Out: the shipped files and schema (slice 05).

## Acceptance
- AC1 Given the docs, when a reader looks for how to write a step, then the concepts page, the workflow recipes and the generated reference show steps by their head key, optional `skills:`, `by:`, `outcomes:` with sibling `means:` / `verdict:`, say that a `like` copy writing `means:` replaces the whole map, say how `norn upgrade` moves an old file, and nothing shows the old wording except where it explains the upgrade. — verifier: agent
- AC2 Given the generated reference, when the docs emit check runs in the unit tier, then it is up to date and the glossary lint passes. — verifier: test

## Checks
- `bun run docs:emit`
- `bun run test`

## Notes
Risk: the shallow `like` merge for `means:`. Never edit `CHANGELOG.md`.
