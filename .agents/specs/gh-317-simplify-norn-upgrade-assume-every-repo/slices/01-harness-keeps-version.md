---
id: gh-317/01
title: The test harness keeps the recorded norn_version
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
A test that rewrites a repo's config after `norn init` keeps the team file's recorded `norn_version`, so the version guard that slice 02 tightens does not refuse every such test. Nothing a person sees changes.

## Scope
User stories: groundwork for "an acting command on a repo with no `norn_version` is refused" and "an acting command on a pre-0.30 repo is refused" (the guard's tests and every other harness test must keep running once the guard refuses a missing version). Seams: S1 (the harness itself). Out: the guard (02).

## Acceptance
- AC1 Given a harness repo after `norn init`, when a test writes config with only local or user keys (or none for the team file), then the team file still exists and records the same `norn_version` as before. — verifier: test
- AC2 Given a harness repo after `norn init`, when a test writes config with team keys, then the team file holds those keys and the recorded `norn_version`, the version first. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Plan prefactor 1. A pure prefactor: no golden case, transcript or observe snapshot may change; if one does, the change altered behaviour. A test that sets `norn_version` on purpose through `h.config(...)` keeps that value over the recorded one.
