---
id: gh-71/03
title: A label-swap method on the remote port
depends_on: [gh-71/02]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
The remote port can replace one issue label with another, in the gh and glab adapters and the harness's fake remote, each proven by the remote contract suite. Unused by norn for now.

## Scope
Behaviour: enables B19, B20. Seams: the port contract suites (`remoteContract`). Plan prefactor 3. Out: calling it on a round start (07).

## Acceptance
- AC1 (B19) Given an issue labelled `norn:wf:triage`, when the port replaces `norn:wf:triage` with `norn:wf:story`, then reading the issue back shows `norn:wf:story` and not `norn:wf:triage`, for gh and glab over the scripted CLIs and for the fake remote. — verifier: test
- AC2 (B19) Given an issue without the old label, when the port replaces it, then the new label is added and nothing fails. — verifier: test
- AC3 (B20) Given a provider CLI that fails, when the port replaces a label, then it rejects with the port's error (portError), never silently succeeding; and the fake remote can be told to fail the call so later slices can test the warning. — verifier: test

## Checks
- `bun test --config=bunfig.integration.toml packages/adapters/test/integration/contract/contract.test.ts packages/cli/test/integration/contract-fakes.test.ts`
- `bun test packages/adapters`
- `bun run typecheck`

## Notes
Adapters perform one effect each and never decide (ports rule). Record gh/glab argument fixtures alongside the existing ones. Fake remote: record the call so S1 tests can assert it.
