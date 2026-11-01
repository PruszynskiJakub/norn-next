---
id: gh-71/06
title: Start the next round with norn story edit --workflow
depends_on: [ gh-71/04, gh-71/05 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: test }
  - { id: AC11, verifier: test }
  - { id: AC12, verifier: test }
  - { id: AC13, verifier: agent }
---

## Goal
On a story whose round is finished, `norn story edit <story> --workflow <name> [--at <step>]` starts a new numbered round in its own folder, with fresh counters, the same mode, branch, worktree, handoff and PR. Triage then delivery works end to end on one issue.

## Scope
Behaviour: B1, B3, B4, B5, B6, B7, B8, B9, B10, B17, B18, B30 (two rounds), B31 (across rounds), B33, B35 (command side). Seams: S1, S2. Decisions D1 (`round` receipt applied by the tick, rule `round.start`, receipt kinds 14 → 15), D3 (refusal order, minus `--force`), D4 (on a story `--workflow` always starts a round; slices keep the in-place switch), D8 (slices story-wide), D11 (gate prompt text). Out: `--force` and `--at` alone (08), the label swap (07), round shown in views (10).

## Acceptance
- AC1 (B1, B6, B30) Given a story whose triage round is finished with no PR, when `norn story edit <story> --workflow story` runs and the next tick runs, then `runs/_story/rounds/02-story/` exists with the pinned `story` workflow, a fresh state at `refine` and receipts from 0001; `rounds/01-triage/` is kept; the branch is the same; and the inbox shows Your turn for refine. — verifier: test
- AC2 (B1) Given the edit, when the command returns, then it has written only a `round` receipt (workflow name, workflow file hash, target step, `forced: false`, the step the old round is left at) into round 1 and no state; the tick applies it in one action (`round.start`, with a rule case) and one commit. — verifier: test
- AC3 (B3) Given round 1 with a counter at its max, when round 2 starts, then every counter in round 2 is 0. — verifier: test
- AC4 (B5) Given an `auto` story, when round 2 starts, then round 2 is `auto`. — verifier: test
- AC5 (B4, B7) Given a finished round with an open PR on the fake remote, when a `quick` round starts and reaches `open-pr`, then it works in the same worktree on top of the earlier commits, and the existing PR's body is replaced; no second PR is opened, and the story still ends only when that PR merges. — verifier: test
- AC6 (B8) Given a finished triage round, when `--workflow triage` runs, then round 2 is `triage` at `explore`. — verifier: test
- AC7 (B9) Given a finished reproduce round, when `--workflow quick --at sync` runs, then round 2 starts at `sync`; with `--at nope` it is refused, exit 3, naming `quick`'s steps, and nothing is written. — verifier: test
- AC8 (B10) Given a story waiting at `confirm`, when `norn story edit <story> --workflow story` runs without `--force`, then it is refused, exit 3, saying the triage round is not finished, with the `--force` command in `do_instead`; nothing changes. — verifier: test
- AC9 (B17, B18) Given `--workflow sotry`, then it is refused `unknown_workflow` listing the workflows and the round is untouched; given the claim held by another clone, then it is refused with the holder and `norn story checkout <story>`; both write nothing, checked in D3's order. — verifier: test
- AC10 (B31) Given a handoff with Goal / Progress / Resume written in round 1, when round 2 starts, then `runs/_story/handoff.md` is the same file with those sections kept. — verifier: test
- AC11 (B33) Given round 2 reaches its `slices` step with slices integrated in round 1 and new slice files, then slice folders stay at `runs/<nn>-<slug>/`, new ones take the next numbers and record `round: 2`, and finished slices are not run again. — verifier: test
- AC12 (B1, B35) Given a workflow file whose hash changed between the edit and the tick, then the receipt is rejected into the trace and the inbox asks to run the edit again (a rule case); given a mailbox receipt made for round 1's cursor arriving after round 2 started (second clone), then it is rejected as stale; given a story migrated from a flat `$done` record (04, 05), then `--workflow story` starts round 2. — verifier: test
- AC13 (B1, B6) Given a throwaway repo with a triage story, when the person approves `confirm` and runs `story edit <story> --workflow story` with the build of this branch, then `status` shows refine waiting for them in round 2, and the `triage` and `reproduce` gate prompts say approving ends the round and the next one starts with `norn story edit <story> --workflow <name>`. — verifier: agent

## Checks
- `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts packages/cli/test/integration/runtime.test.ts`
- `bun run test`
- `bun run test:integration`
- `bun run test:e2e`
- `bun run typecheck`
- `bun run schema:emit && git diff --exit-code packages/schema/json`

## Notes
D1 follows the `workflow` and `mode` receipts' pattern: receipts before effects (P6), state last (S5). The old round's state gets `$done`; `ended` is only set when forced (08). D4: the story in-place `--workflow X --at s` switch goes away here, and its tests change with it; slices keep it. The gate prompt text (D11) is in the repo-local `.agents/workflows/triage.yaml` and `reproduce.yaml`. Large slice: if it overflows, the person may move AC11 (slices across rounds) into its own slice depending on this one.
