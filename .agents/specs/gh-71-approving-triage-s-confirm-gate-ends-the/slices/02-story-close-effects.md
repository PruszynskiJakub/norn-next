---
id: gh-71/02
title: Story close's effects as one runtime function
depends_on: [ gh-71/01 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: agent }
---

## Goal
`norn story close` keeps doing exactly what it does, but its effects (mark the spec closed, commit, push the story and slice branches, then remove worktrees, local branches, leases, the claim and mailbox refs) live in one runtime function a tick action can call later. No behaviour change.

## Scope
Behaviour: enables B22, B23. Seams: S1 (existing suites). Plan prefactor 2. Out: the GR6b rule and action that call it (09).

## Acceptance
- AC1 (B22, B23) Given the existing story-close and story-reopen integration tests and the rest of the tiers, when they run on this slice, then they pass unchanged, and transcripts and golden are unchanged. — verifier: test
- AC2 (B22) Given a throwaway repo with a story that has a worktree, a pushed branch and a slice, when `bun packages/cli/src/main.ts story close <story>` runs, then the branch is pushed before the worktree and refs go, the spec is closed, and `story reopen` restores it, as with the released norn. — verifier: agent

## Checks
- `bun test --config=bunfig.integration.toml packages/cli/test/integration/story-reopen.test.ts`
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
Push first, remove after: keep that order inside the function (nothing is lost if a removal fails). The function takes the ports it needs, not the command's argv.
