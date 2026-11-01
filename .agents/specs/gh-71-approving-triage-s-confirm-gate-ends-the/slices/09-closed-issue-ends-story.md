---
id: gh-71/09
title: A closed issue with no PR ends a finished story
depends_on: [ gh-71/02, gh-71/05, gh-71/06, gh-71/08 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: agent }
---

## Goal
When the person closes the issue of a story whose round is finished and which has no PR, norn finishes the story itself, exactly as `norn story close` would, and reopening brings it back.

## Scope
Behaviour: B22, B23, B24 (the guard side). Seams: S2, S1. Decisions D5 (GR6b), plan prefactor 2 (the close effects). Out: the finished-round inbox item (05).

## Acceptance
- AC1 (B22) Given a finished round, no PR, no unfinished slice and the issue seen `closed`, when decide runs, then it emits the GR6b close action (a rule case); given the issue `null`/unobserved, an open PR, an unfinished slice or an unfinished round, then it does not. — verifier: test
- AC2 (B22) Given that story in the harness and the issue closed on the fake remote, when sync and a tick run, then the story branch is pushed with the record on it before the worktree, the local branch, the claim and the mailbox refs are removed, the spec is marked closed, and the story is gone from the inbox — the same effects as `norn story close`. — verifier: test
- AC3 (B23) Given a story finished this way, when the issue is reopened and `norn story reopen <story>` runs, then it is back at its finished round, and `norn story edit <story> --workflow story` starts round 2. — verifier: test
- AC4 (B24) Given an unfinished round when the issue is closed, then the story parks with `remote: issue closed` and is not closed. — verifier: test
- AC5 (B22) Given a throwaway repo with a finished triage story and no PR, when the issue is closed on the fake or scripted remote and the build of this branch syncs, then `status` no longer lists the story and the branch on the remote holds the record. — verifier: agent

## Checks
- `bun test packages/core`
- `bun test --config=bunfig.integration.toml packages/cli/test/integration/story-reopen.test.ts packages/cli/test/integration/runtime.test.ts`
- `bun run test`
- `bun run typecheck`

## Notes
Risk from the plan: a wrong "closed" fact would close active work — hence only an observed `closed`, finished round, no PR. Push first (02's function keeps the order), so nothing is lost and reopen works unchanged.
