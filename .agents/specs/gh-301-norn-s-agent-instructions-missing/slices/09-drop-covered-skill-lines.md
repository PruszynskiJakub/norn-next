---
id: gh-301/09
title: Bundled skills drop the protocol lines the brief covers
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Bundled skills stop repeating the push and branch rules the brief's How to work already states, so the brief alone adapts the skills to the step.

## Scope
User stories: skills drop only lines the brief covers, and stay mode-unaware. Seams: S5. Decision D15. Out: any other skill text change (gh-301/08, 10).

## Acceptance
- AC1 Given the bundled skill sources, then "never push" is gone from `norn-implement` and `norn-merge` (their "Commit locally" stays), "Never push." from `norn-diagnose` and "Never create or switch branches for it." from `norn-prototype`, and no other line is dropped, pinned by the assets test so they stay gone. — verifier: test
- AC2 Given every bundled skill source, then none names the mode (auto or manual), pinned by the assets test. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
The brief already forbids pushes and branch switches on this base, so this slice needs none of the brief slices. Edit at `packages/cli/assets/skills/`, never the installed copies.
