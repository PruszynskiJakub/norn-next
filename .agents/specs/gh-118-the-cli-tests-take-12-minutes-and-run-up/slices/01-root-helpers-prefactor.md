---
id: gh-118/01
title: Root test code may import @norn packages; helpers name their outputs from the repo root
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
---

## Goal
Both prefactors land, with no test moved and no behaviour changed: root `test/` and `scripts/` can import `@norn/<pkg>` by name under the dependency rule, and the transcript, observe snapshot and golden harvest helpers locate their pinned outputs from the repo root, so helpers and outputs can later move apart byte-identical.

## Scope
Behaviour: B15, B18, B19 (groundwork only). Seams: S1, S3. Out: moving any file (slices 03–05), new tier configs (slice 03).

## Acceptance
- AC1 (B15) Given the root package declares the six workspace packages as dev dependencies, when root `test/` or `scripts/` code imports an `@norn/*` package it does not declare, then the repo rules fail naming the file and the import; with the declarations in place every current root import passes. — verifier: test
- AC2 (B18, B19) The transcript, observe snapshot and golden harvest helpers resolve their output folders from the repo root; with nothing moved, the full suite passes and every transcript, snapshot and golden file is unchanged (`git status` clean after `bun test`). — verifier: test
- AC3 (B19) `NORN_TRANSCRIPT_UPDATE=1` on one transcript flow and on the observe snapshots test leaves the pinned files byte-identical. — verifier: test

## Checks
- `bun install --frozen-lockfile`
- `bun test`
- `bun run typecheck`
- `git diff --exit-code -- packages/cli/test/transcripts packages/cli/test/observe-snapshots packages/core/test/golden`

## Notes
Plan prefactors 1 and 2. The planning spike confirmed a root helper and a package source share one module instance through the isolated linker; recheck it once here with a real import.
