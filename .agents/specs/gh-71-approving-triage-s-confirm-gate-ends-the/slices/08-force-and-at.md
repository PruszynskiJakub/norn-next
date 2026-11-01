---
id: gh-71/08
title: End an unfinished round with --force, move inside a round with --at
depends_on: [gh-71/06, gh-71/07]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: agent }
---

## Goal
A person can end a round that waits at a gate, on an ask or stuck and start the next one in one command (`--force`), refused while an agent or a slice is still working; and `--at <step>` alone jumps inside the current round.

## Scope
Behaviour: B11, B12, B13, B14, B15, B16, B17 (with `--force`), B32. Seams: S1. Decisions D1 (`forced`, `ended`), D3 (refusal order), D4 (`--at` alone journaled as a `workflow` receipt with the same workflow and hash). Out: showing "ended by the person" in `run list` (10).

## Acceptance
- AC1 (B11, B32) Given a story waiting at `confirm`, when `norn story edit <story> --workflow story --force` runs and the tick applies it, then round 1's own state records it ended by the person at `confirm` (with the receipt id), and round 2 (`story`) starts at `refine`. — verifier: test
- AC2 (B11) Given a story `$stuck` in round 1, when `--workflow quick --force --at sync` runs, then round 2 starts at `sync`. — verifier: test
- AC3 (B12) Given the fake runner running an agent on `explore`, when `--force` runs, then it is refused, exit 3, naming the step and `norn run cancel <story>`; nothing changes. — verifier: test
- AC4 (B13) Given slice `<story>/02` at `implement`, when `--force` runs, then it is refused, exit 3, naming the slice; given only integrated or dropped slices, it is not refused. — verifier: test
- AC5 (B14, B17) Given a finished round, `--force` behaves exactly as without it (same receipt but `forced: false`, same new round); given `--workflow sotry --force`, it is refused `unknown_workflow` and the unfinished round is untouched. — verifier: test
- AC6 (B15) Given a story round waiting at `ready`, when `norn story edit <story> --at implement` runs, then the same round's cursor is at `implement` with its counters kept and no new round folder; `--at nope` is refused, exit 3, naming the round's steps. `--at` without `--workflow` is no longer a usage error. — verifier: test
- AC7 (B16) Given a finished round, when `--at explore` runs alone, then it is refused, exit 3, saying the round is finished and pointing to `norn story edit <story> --workflow <name>`. — verifier: test
- AC8 (B11, B12, B13) Every refusal above exits 3 with a `CliError` and writes no receipt, state or commit (checked by the record's files and the branch head before and after). — verifier: test
- AC9 (B11, B15) Given a throwaway repo with a triage story at `confirm`, when the person runs `--workflow story` (refused), then `--workflow story --force`, then `--at plan` in round 2 with the build of this branch, then each output reads as the spec's examples and `status` shows round 2 at `plan`. — verifier: agent

## Checks
- `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/run-rerun-cancel.test.ts`
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D3 order: claim elsewhere → unknown workflow → unknown `--at` step → unfinished without `--force` → running agent → unfinished slice; `--at` alone on a finished round is refused. The fake runner stands in for the running agent (testing decisions). Slices keep today's in-place `--workflow X --at s` (D4) — keep that test green.
