---
id: gh-61/09
title: "`norn init` records the version once and never moves it"
depends_on: [ gh-61/01, gh-61/02, gh-61/04 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
`norn init` writes `norn_version` only in a repo that has none; on a repo set up for another version it sets up the machine, leaves the version and drifted bundled skills alone and points at `norn upgrade`.

## Scope
Behaviour: B1, B28. Seams: S1. Out: `upgrade` (slice 08).

## Acceptance
- AC1 (B1) A repo with no `norn_version`, binary 0.19.0 → `norn init` leaves `norn_version: 0.19.0` uncommitted in the team file with the rest of its changes and prints "norn version: 0.19.0 (recorded)". — verifier: test
- AC2 (B28) Binary 0.19.2, repo at 0.19.0 with one bundled skill edited and one missing → `init` writes the machine files as today, copies in the missing skill, leaves the edited one and `norn_version` untouched, and prints "this repo is on norn 0.19.0, you run 0.19.2: `norn upgrade` moves it", naming the differing skill. — verifier: test
- AC3 (B28) Binary equal to the repo's version → `init` repairs drifted bundled skills as today. Effect transcripts that cover `init` are updated for the new key and the diff reviewed. — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D10. Writing the key edits the team file in place (comments kept), the same helper `upgrade` uses; whichever of 08/09 lands first adds it.
