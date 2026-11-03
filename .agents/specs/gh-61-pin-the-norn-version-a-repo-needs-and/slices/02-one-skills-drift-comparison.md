---
id: gh-61/02
title: One bundled-skills drift comparison in store
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
---

## Goal
Prefactor 2: one store function says which of norn's bundled skills in a skills folder differ from the running binary's copies; `doctor` uses it instead of its own comparison. No behaviour change.

## Scope
Behaviour: B21 (only bundled names compared); groundwork for B18, B20, B24, B28. Seams: S1 (doctor unchanged). Out: making drift a failure (slice 10), holding steps (slice 11).

## Acceptance
- AC1 (B21) Given a skills folder where a bundled skill is edited, one is missing and a repo-local skill (`release`, no bundled copy) differs from anything shipped, when the drift function runs, then it returns exactly the edited bundled skill: a missing skill is not drift and repo-local skills are never named. — verifier: test
- AC2 (B21) `norn doctor` prints the same skills line and warning as before for a drifted skill (still a warning in this slice). — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
Prefactoring 2. Takes the skills folder, the bundled source folder and the bundled names; no config reading inside. Observe will call it per unit worktree on every tick (Risk "Observe cost"): keep it cheap (compare sizes before bytes) if that is simple now.
