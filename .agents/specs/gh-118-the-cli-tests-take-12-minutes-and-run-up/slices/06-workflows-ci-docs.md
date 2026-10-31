---
id: gh-118/06
title: Workflow check, implement instructions, CI, release and docs follow the tiers
depends_on: [ gh-118/03 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: agent }
workflow: slice
---

## Goal
Everything that runs or names tests follows the tiers: the workflow `test` check runs unit, integration, typecheck; implement steps and the bundled norn-implement skill ask for the fast suite; CI runs unit + typecheck first, then integration, sharded e2e and the package; the release runs unit + typecheck; AGENTS.md and README describe the three tiers; `test:fast` and `test:cli` are gone.

## Scope
Behaviour: B7, B8, B9, B10, B11, B12, B13, B21. Seams: S1. Out: the PR measurements (slice 07).

## Acceptance
- AC1 (B7) `test:fast` and `test:cli` are not package scripts, and no live file (scripts, AGENTS.md, README, CONTRIBUTING, `.agents/workflows`, `.github`, skill sources and copies, `scripts/`, tests) names them; spec folders and `docs/audit-*` are exempt. This lint replaces the old test:fast/test:cli split test. — verifier: test
- AC2 (B8) The `test` check of quick, story, slice and bug runs `bun install --frozen-lockfile && bun run test && bun run test:integration && bun run typecheck` with its 15 m timeout; comments naming test:fast are rewritten. — verifier: test
- AC3 (B9) The implement step of quick, story, slice and bug says to run `bun run test` after each change, that integration runs in the `test` check and e2e in CI. — verifier: test
- AC4 (B10) The shipped norn-implement skill source asks for the repo's fast suite after each change, says slower tiers run in their own check, and no longer says "full suite". — verifier: test
- AC5 (B11, B12) ci.yml has a `unit` job (bun run test + typecheck); `integration`, an `e2e` matrix over 3 shards (bun `--shard`, `fail-fast: true`) and `package` all need it; each job that spawns git sets a git identity. — verifier: test
- AC6 (B13) release.yml's test step runs exactly `bun run test` and the type check, and no integration or e2e command. — verifier: test
- AC7 (B21) AGENTS.md's Commands list `bun run test`, `bun run test:integration`, `bun run test:e2e`; its handback rule asks for the unit tier and the type check; every golden, transcript, snapshot and contract path it names exists; README's test line no longer says "all tests". — verifier: test
- AC8 (B11, B12) On this story's PR run, the unit job runs first, integration, the e2e shards and package start after it, and the e2e jobs show as separate shards. — verifier: agent (on the pushed PR's CI run)

## Checks
- `bun test`
- `bun run typecheck`

## Notes
D8–D11, D14. Edit only `packages/cli/assets/skills/norn-implement` (the repo copy refreshes on `norn init`); norn-merge's "full suite" stays (D9). The new lints go in the repo rules; if slice 05 already moved them to `test/repo/`, edit them there. CI's "red unit test skips the rest" (B11 example) is proven by the `needs` structure (AC5); a deliberately red push is not required.
