---
id: gh-195/03
title: Sync fetches only claim and mailbox refs
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
A sync fetches `refs/norn/claims/*` and `refs/norn/inbox/*` by name instead of all of `refs/norn/*`, so archive refs added later never ride along with every sync.

## Scope
Behaviour: B30 (the sync half). Seams: S1. Out: fetching one story's record on demand (gh-195/12, gh-195/16).

## Acceptance
- AC1 (B30) Given a bare remote that holds a claim ref, a mailbox ref and a ref under another `refs/norn/` prefix (for example `refs/norn/runs/gh-9`), when a clone runs a tick, then its local refs hold the claim and the mailbox ref and not the other one. — verifier: test
- AC2 (B30) Pruning still works per prefix: a claim or mailbox ref deleted on the remote is gone locally after the next tick, and every existing claim, mailbox and team test still passes. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run test:integration`

## Notes
Plan prefactor 3. Take the prefixes from `claimRef` / `mailboxPrefix` in schema's ids, never by hand. The other-prefix ref in AC1 is created with plain git on the bare remote; no norn code writes it yet.
