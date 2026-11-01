---
id: gh-71/10
title: Status, story view, handoff header and run list show rounds
depends_on: [gh-71/08]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: agent }
---

## Goal
A person sees which round a story is in and how earlier rounds ended, in `norn status`, `norn story view`, the handoff header and `norn run list`.

## Scope
Behaviour: B28, B29, B32 (shown), B36 (shown as round 1). Seams: S1. Decision D10. Out: the record layout (04) and how a round ends (06, 08).

## Acceptance
- AC1 (B28) Given a story in round 2 of `story` at `refine`, then the handoff header line reads "Round 2 · Workflow: story · Step: refine (attempt 1)"; a story with one round shows "Round 1". — verifier: test
- AC2 (B28) Given the same story, then `status --json` and `story view` (markdown and `--json`) carry the round number and its workflow next to the step. — verifier: test
- AC3 (B29, B32) Given a story with a triage round that finished and a story round, then `run list <story>` prints "round 1 · triage" with its runs and "finished", then "round 2 · story" with its runs; a round ended with `--force` shows "ended by the person at <step>". — verifier: test
- AC4 (B36) Given a flat record merged into the base before this ships, then `run list` shows one heading "round 1 · <workflow>" and writes nothing. — verifier: test
- AC5 (B28, B29) Given a throwaway repo with a story taken through a triage round and a forced story round with the build of this branch, then `status`, `story view`, `run list` and the handoff header read as the spec's examples. — verifier: agent

## Checks
- `bun test --config=bunfig.integration.toml packages/cli/test/integration/status.test.ts packages/cli/test/integration/story-view.test.ts packages/cli/test/integration/records.test.ts`
- `bun test packages/core`
- `bun run test`
- `bun run test:e2e`
- `bun run typecheck`

## Notes
Built on story facts `rounds: [{n, workflow, ended}]` (D2, added in 04). The brief snapshot and observe snapshots change with the header; regenerate and review. Independent of 07 and 09.
