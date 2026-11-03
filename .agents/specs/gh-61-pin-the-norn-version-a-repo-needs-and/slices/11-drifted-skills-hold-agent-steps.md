---
id: gh-61/11
title: Drifted skills hold a unit's agent steps, and the inbox says why
depends_on: [ gh-61/02, gh-61/06 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
---

## Goal
Observe records each unit worktree's (and the main checkout's) drifted bundled skills; decide starts no agent step in a drifted unit while its gates, checks, syncs and merges go on; the inbox names the fix.

## Scope
Behaviour: B18, B19, B21, D14. Seams: S3, S1 (observe). Out: refusing `brief`/`start`/`chat` (slice 12), the multi-tick story (slice 13).

## Acceptance
- AC1 (B18) `decide` with a unit whose Facts carry `skills_drift: [norn]` at an agent step → noop `agent.skills_drift`, no launch, also in manual mode (the rule sits before the mode check); a sibling unit without drift launches; the drifted unit's due gate, check and base sync are still decided. A hand-built rule case makes `agent.skills_drift` fire for the golden test. — verifier: test
- AC2 (B18, D14) A unit whose own team file records a `norn_version` newer than the running binary is not observed as drifted, so its agent step launches. — verifier: test
- AC3 (B19) `buildInbox` shows the held unit under Unblock: "skills differ from norn 0.19.0 (norn, norn-implement): bring the base in with `norn story update-branch gh-61`"; a drifted main checkout gives one repo-level item "skills differ from norn 0.19.0: run `norn upgrade` and commit". — verifier: test
- AC4 (B21) A repo-local skill that differs produces no drift, no hold and no item. — verifier: test
- AC5 (B18) Through the cli harness: a unit worktree with an edited bundled skill → `norn tick` launches no agent for it, and `norn status` shows the item; inbox parity holds. — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D5 (per-unit `skills_drift`, absent when not observed; repo-level `norn.skills_drift`; the bundled folder passed in by the cli so core stays pure), D6, D14. Golden cases, observe snapshots and transcripts move with the new facts: update only for this change and review the diff. Watch observe cost (Risks).
