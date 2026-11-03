---
id: gh-61/01
title: The binary's version is a command dependency
depends_on: []
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Prefactor 1: commands read the running norn's version from their context (defaulting to the package version) instead of the module constant, so a test can run the CLI as any binary version. No behaviour change.

## Scope
Behaviour: none directly; enables B6–B17, B23–B25, B28 tests. Seams: S1. Out: any check of the version against the repo (slices 04, 05).

## Acceptance
- AC1 (B6) Given the cli harness built with version `0.18.1`, when it runs `norn --version` and a `tick`, then `--version` prints `0.18.1` and the tick trace records `0.18.1`; without the option both show the package version. — verifier: test
- AC2 (B6) Every existing test passes unchanged and no command reads the version module constant directly (only the default wiring does). — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
Prefactoring 1. Every later slice that tests a mismatch uses this dependency; keep the harness option name obvious (`version`).
