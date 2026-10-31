---
id: gh-118/07
title: Turn the unit guard on, ban spawning imports, and measure the tiers
depends_on: [gh-118/04, gh-118/05, gh-118/06]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: agent }
  - { id: AC4, verifier: person }
  - { id: AC5, verifier: agent }
  - { id: AC6, verifier: agent }
  - { id: AC7, verifier: agent }
  - { id: AC8, verifier: agent }
  - { id: AC9, verifier: test }
---

## Goal
`bun test` is the guarded unit tier: a unit test that spawns fails, a unit test cannot import the harness or store's git functions, and the whole story is measured — unit under 30 s, every tier green three times, nothing lost, nothing changed, with the numbers in the PR body.

## Scope
Behaviour: B1, B3, B4, B14, B15, B17, B18, B20, B22. Seams: S1, S2, S4, S5. Out: further speed-ups of integration/e2e (out of scope).

## Acceptance
- AC1 (B4, B1) The root bunfig preloads the unit guard and the integration and e2e configs do not; `bun test` passes with it on. — verifier: test
- AC2 (B15) A unit test importing the cli harness, the transcript recorder, the observe snapshot helpers or store's git functions fails the repo rules naming the file and the import; fake herdr and the golden harvest stay allowed. — verifier: test
- AC3 (B4) A throwaway unit test 'reads the head' that runs `git rev-parse HEAD` fails under `bun test` with `(fail) reads the head` beside the guard's message; output recorded. — verifier: agent
- AC4 (B1, B3) In a clean checkout, `time bun run test` runs only unit and `test/repo/` tests (no harness test in its summary) and takes under 30 s wall clock, three runs, all green. — verifier: person, because the 30 s target is on the maintainer's Mac (12 cores, bun 1.3.13), which the agent's machine may not match
- AC5 (B17) The tier totals add up to 1,423 tests in the baseline's files, give or take tests changed on purpose, each listed. — verifier: agent
- AC6 (B18) Across the whole branch, transcripts and snapshots differ from main by renames only; `bun run golden` adds no case and `bun run golden -- --update` changes no decision. — verifier: agent
- AC7 (B20) `bun run test`, `bun run test:integration` and `bun run test:e2e` each pass three runs in a row locally, and the PR's CI is green. — verifier: agent
- AC8 (B22) The PR body has a table: baseline 702 s cli / 630 s full serial; unit N s; `test` check N s; CI push-to-green N min, measured on this branch. — verifier: agent
- AC9 (B14) A test file outside a tier folder (e.g. `packages/view/test/foo.test.ts`) fails the repo rules with "packages/view/test/foo.test.ts is not in a tier folder (unit/, integration/, test/e2e/, test/repo/)"; on this checkout no `*.test.ts` sits outside one. — verifier: test

## Checks
- `bun test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun run typecheck`

## Notes
D2, D13. Hidden spawns found when the guard turns on (`ps` in brief, `lsof` in strays, `git remote` in detect, Risks) move or split the file here. The e2e shard count may change after measuring (D10) without reopening the plan.
