---
id: gh-71/07
title: The issue's norn:wf label follows the round
depends_on: [ gh-71/03, gh-71/06 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
When a round starts, the remote issue's `norn:wf:<old>` label is replaced by `norn:wf:<new>`, for visibility only; a failure warns and the round starts anyway.

## Scope
Behaviour: B19, B20. Seams: S1. Decision D9. Out: the port method (03).

## Acceptance
- AC1 (B19) Given a finished triage round on an issue labelled `norn:wf:triage`, when a `story` round starts, then the fake remote records one label swap from `norn:wf:triage` to `norn:wf:story`. — verifier: test
- AC2 (B19) Given an issue whose `norn:wf:` label was edited on the remote, when ticks run, then no round starts and the current round's workflow does not change. — verifier: test
- AC3 (B20) Given the fake remote failing the label call, when a round starts, then round 2 starts as in 06, the action result and the trace carry a warning that the label was not updated, and the command's output says so. — verifier: test

## Checks
- `bun test --config=bunfig.integration.toml packages/cli/test/integration/human.test.ts`
- `bun run test`
- `bun run typecheck`

## Notes
The swap is part of the `round.start` action (D1), after state is written; a failure is a warning, never a failed action. The command itself writes only the receipt, so "the command's output" warning means the output of the tick or `watch` line that applied it; if the person runs the edit and the tick in one go (as today's human verbs do when they tick), show it there.
