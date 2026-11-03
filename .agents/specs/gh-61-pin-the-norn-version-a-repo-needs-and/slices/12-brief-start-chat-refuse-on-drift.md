---
id: gh-61/12
title: "`brief`, `story start` and `story chat` refuse on drifted skills"
depends_on: [gh-61/01, gh-61/02, gh-61/04]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
A session started by hand is held to the same rule as one norn launches: `norn brief`, `norn story start` and `norn story chat` refuse when the worktree the agent would run in holds drifted bundled skills.

## Scope
Behaviour: B20 (with B21 and D14 applied). Seams: S1. Out: the inbox item (slice 11).

## Acceptance
- AC1 (B20) In a unit worktree with an edited `norn` skill → `norn brief` prints `CliError` code `skills_drift` "skills differ from norn 0.19.0: norn", `do_instead` "bring the base in with `norn story update-branch <story>`", exit 3. — verifier: test
- AC2 (B20) `norn story start <unit>` and `norn story chat <story>` refuse likewise for the unit's worktree. — verifier: test
- AC3 (B21, D14) A differing repo-local skill, or a unit worktree whose team file records a newer `norn_version` than the binary, is not refused. — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D11. Same `do_instead` text as slice 11's inbox item: build it once in core next to the printed commands (whichever slice lands first).
