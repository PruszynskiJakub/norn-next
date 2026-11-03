---
id: gh-61/03
title: Rename `norn migrate` to `norn upgrade`, alias kept
depends_on: []
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
Prefactor 3: `norn upgrade` does exactly what `norn migrate` does today; `norn migrate` stays as a deprecated alias that says so; every refusal, hint and doc that named `migrate` names `upgrade`.

## Scope
Behaviour: B30, B29 (main-checkout-only and tick-lock refusals carried over). Seams: S1, S5. Out: the version and skills work of `upgrade` (slice 08).

## Acceptance
- AC1 (B30) Given an old-layout repo, when `norn upgrade` runs in the main checkout, then it stages the same moves `norn migrate` staged before, and `norn migrate` does the same and prints one line "`norn migrate` is now `norn upgrade`; the old name goes in the next minor" on stderr (the JSON value is unchanged). — verifier: test
- AC2 (B29) `norn upgrade` in a unit worktree is refused with exit 3 naming the main checkout; while `norn watch` holds the tick lock it is refused with exit 3 and `do_instead` "stop `norn watch` and run it again"; a rerun changes nothing. — verifier: test
- AC3 (B30) `norn help` lists `upgrade` and marks `migrate` deprecated; the old-layout refusal, the moved-config-key error and the slice-with-`needs` refusal all print `norn upgrade` (printed-commands test). — verifier: test
- AC4 (B30) The docs and generated reference name `norn upgrade`; the docs lint passes and the reference is not stale. — verifier: test

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
Prefactoring 3, D9 (alias runs the same code). Move the existing migrate tests over rather than duplicating them. `bun run docs:emit` after the rename.
