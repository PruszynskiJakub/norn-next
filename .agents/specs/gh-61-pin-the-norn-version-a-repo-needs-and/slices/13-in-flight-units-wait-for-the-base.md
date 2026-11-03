---
id: gh-61/13
title: In-flight units wait for the base to bring the new skills in
depends_on: [ gh-61/11 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
---

## Goal
A story in flight when the base moves to a new norn version and new skills is held at its next agent step until a base sync or `norn story update-branch` brings the skills in, then it launches with its pinned workflow unchanged.

## Scope
Behaviour: B22. Seams: S4. Out: claim handover (claims expire as today).

## Acceptance
- AC1 (B22) e2e story: a story runs on the old skills; the base moves to new bundled skills; the next agent step is held (noop `agent.skills_drift`, Unblock item); the base sync merges the base into the story branch; the following tick launches the step; the pinned workflow is the same. — verifier: test

## Checks
- `bun run test:e2e`
- `bun run typecheck`

## Notes
Built on the base-sync e2e story. The test plays the binary as the new version (slice 01's dependency) so the version guard passes. If the base-sync transcript moves, update it only for this change.
