---
id: gh-118/02
title: Unit guard preload that fails a test which spawns
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
A guard preload exists that wraps `Bun.spawn` and `Bun.spawnSync` and fails the test that starts a child process, with a message naming the command, the test file and where the test belongs. It is not yet in the root config (slice 07 turns it on); later slices load it by hand (`bun test --preload <guard> <folder>`) to sort files into tiers (D5).

## Scope
Behaviour: B4. Seams: S2. Out: enabling it for `bun test` (slice 07), moving files.

## Acceptance
- AC1 (B4) Given the guard is installed, when a test starts `git rev-parse HEAD` through `Bun.spawn`, `Bun.spawnSync` or node's `child_process.spawn`, then the call throws at once with a message naming the argv, the test file and `test/integration/`. — verifier: test
- AC2 (B4) Given code under test catches the guard's error, when the test ends, then the guard's `afterEach` still fails that test with the same message. — verifier: test
- AC3 (B4) The message never includes the spawn's environment or options: a spawn with a secret-looking env var produces a message without it. — verifier: test
- AC4 (B4) Running a throwaway unit test that spawns git with `bun test --preload <guard>` shows bun's `(fail) <test name>` line beside the guard's message, and a pure test in the same file passes. — verifier: agent

## Checks
- `bun test`
- `bun run typecheck`

## Notes
D2. No current-test-name API in bun 1.3.13: bun's own `(fail)` line names the test (B4 example as amended). The self-test installs the guard explicitly so it runs before the guard is in the root bunfig.
