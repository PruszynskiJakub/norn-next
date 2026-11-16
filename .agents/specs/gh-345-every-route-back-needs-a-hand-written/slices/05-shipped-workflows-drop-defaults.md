---
id: gh-345/05
title: Shipped workflows drop the counters the defaults now give
depends_on: [ gh-345/01, gh-345/03 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: agent }
---

## Goal
The bundled workflows and this repo's workflows hold only what differs from the defaults. Loaded, they count every edge exactly as before, and the golden cases change in counter names only.

## Scope
User stories: the shipped files holding only what differs from the defaults; every shipped workflow keeping its counting (`integrate.conflict` the stated exception); golden cases changing in counter names only. Seams: S1, golden. Out: docs (slice 06).

## Acceptance
- AC1 Given the edited `quick`, `story`, `slice`, `refinement` and shared files (bundled and this repo's, release included), when loaded, then slice 01's invariant table holds unchanged. Its one listed difference is `integrate.conflict` also resetting on `integrate.done`. — verifier: test
- AC2 Given the edited files, when read, then no `counters:` entry remains whose max and reset match the defaults. What is kept: `ship`'s CI-failed exit with `max: 3` (`ci-failed` bundled, `failed` in this repo), `resolution-review.changes_requested` with `max: 2`, `approve-slices.reject` with `max: 3`, `qa_loop` as a shared name, and `stale_loop` as a shared name wherever more than one edge shares it. The `workflow templates` test asserts the new counter counts. — verifier: test
- AC3 Given the golden cases regenerated with `bun run golden -- --update`, when the golden tier runs, then it passes. — verifier: test
- AC4 Given the golden diff from that update, when it is read, then every change is a counter name (for example `test_loop` → `test.fail`) and no decision, target or outcome changed. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run golden -- --update` (review the diff before committing)
- `bun run docs:emit` (the emitted reference in `docs/reference.md` is generated from the shipped workflows; commit what it writes)

## Notes
D8. Edit every shipped workflow in both `packages/cli/assets/workflows/` and `.agents/workflows/`; release lives only in `.agents/`. Shipped quick derives `ship.stale`. The shared `stale_loop` stays in shipped story, release, and this repo's quick and story. Slice drops `conflict_loop`. If the invariant table shows any other difference, the derivation or the edit is wrong, not the table.
