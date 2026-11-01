---
id: gh-71/01
title: One resolver for a unit's record folder
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: agent }
---

## Goal
Every reader and writer of a unit's record (`runs/<unit>`) finds it through one store resolver, so the later move of the story record into round folders changes one function instead of about ten. No behaviour change.

## Scope
Behaviour: enables B30, B34, B36. Seams: S1 (existing suites). Plan prefactor 1. Callers moved: act's env and start, story checkout, leases, the human-verb remote read, brief's rulings scan, reopen, tidy, the unpushed check, observe and the view. Out: the round layout itself (04).

## Acceptance
- AC1 (B30) Given the existing unit, integration and e2e tiers, when they run on this slice, then they pass with no test changed, and golden, effect transcripts, observe snapshots and the brief snapshot are unchanged. — verifier: test
- AC2 (B30, B36) Given the package sources, when the repo test scans them, then no source outside the store's path module builds a unit's record path from `runs` and a unit dir by hand (a repo test or a grep check in the suite pins this). — verifier: test
- AC3 (B34) Given a throwaway repo with a story started and a slice running, when `bun packages/cli/src/main.ts status`, `story view`, `run list` and `brief` run against it, then their output matches the released norn's on the same repo. — verifier: agent

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun run typecheck`

## Notes
D2: the unit reference gains a record folder field filled by the resolver; for now it equals `runs/<dir>` for every unit. Decide must stay pure: the resolver's result reaches decide through Facts (the unit reference), not by calling store. If a hard-coded `runs/_story` in a test helper must move too, move it to the same resolver.
