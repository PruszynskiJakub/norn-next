---
id: gh-345/01
title: Shared-exit routes kept after flattening, and today's counting pinned
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
Groundwork that changes no behaviour. After flattening, the loader still knows which shared-file exit each flat edge left by, along with that use route's `counter:` and `max:`. A test pins how every shipped workflow counts today, so later edits to those files are checked against it.

## Scope
User stories: groundwork for a shared exit counted once (`<use step>.<exit>`) and for every shipped workflow keeping its counting. Seams: S1. Out: deriving any counter (slices 02, 03) and editing any workflow file (slice 05).

## Acceptance
- AC1 Given every bundled workflow and every one of this repo's workflows (release included), when each is loaded, then its pinned source and hash are byte for byte what they are on today's base. — verifier: test
- AC2 Given a workflow whose `use` step routes a shared file's exit (for example `broken` of the base update) back to a step, when it is loaded, then the loader reports for each flat edge that left through that exit the `<use step>.<exit>` it left by and that use route's counter and max, and the pinned text is unchanged. — verifier: test
- AC3 Given each shipped workflow (the bundled ones and this repo's, release included) as it is today, when it is loaded, then an invariant table taken from it holds: for every counted edge, its max and reset edges, plus the groups of edges sharing a counter, all without counter names. The test compares the loaded files against this table, so a later edit that changes any bound fails it. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
This is the Plan's prefactor, and it also writes the invariant test (D9). The table must be taken from today's files, before any workflow file is edited. Leave room in the test to list one known difference: slice 05 adds `integrate.conflict` also resetting on `integrate.done`. Treat the exit information as the loader's own data. The test observes it through the loader's result, never through flattener internals, so expose it where the loader returns it (for example next to `included`).
