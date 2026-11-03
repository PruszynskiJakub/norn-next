---
id: gh-61/08
title: "`norn upgrade` moves the version, the skills and the files in one staged diff"
depends_on: [ gh-61/02, gh-61/03, gh-61/05 ]
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: agent }
---

## Goal
`norn upgrade` moves the repo to the running binary's version: it writes `norn_version`, rewrites the bundled skills and runs the file migrations, stages all of it, never commits, never moves the version back, and changes nothing when there is nothing to do.

## Scope
Behaviour: B13, B15, B16, B17 (B29 kept from slice 03). Seams: S1. Out: `init` (slice 09).

## Acceptance
- AC1 (B13) Binary 0.19.0, repo at 0.17.0 with a drifted bundled skill and a moved config key → `norn upgrade` stages `norn_version: 0.19.0` (team file comments kept), the bundled skills rewritten and relinked, and the key moved; nothing is committed; the output says "norn version 0.17.0 → 0.19.0; skills updated: …; config: …". A repo without the key gets it written. — verifier: test
- AC2 (B15) Binary 0.19.0, repo at 0.19.0, skills matching, nothing to migrate → "already on norn 0.19.0: nothing to upgrade" and `git status` shows no change. — verifier: test
- AC3 (B16) Binary 0.19.2, repo at 0.19.0 → writes `norn_version: 0.19.2` and refreshes the skills; after committing, binary 0.19.1 is refused by `tick`. — verifier: test
- AC4 (B17) Binary 0.18.1, repo at 0.19.0 → `CliError` "this repo is set up for norn 0.19.0; upgrade will not move it back", `do_instead` "install norn 0.19.x", exit 3, no file changed (checked before any write); `norn migrate` behaves the same. — verifier: test
- AC5 (B13) In a throwaway repo, the dev build's `upgrade` output and `git diff --staged` read as one reviewable change. — verifier: agent

## Checks
- `bun run test`
- `bun run test:integration`
- `bun run typecheck`

## Notes
D9 order: main checkout and tick lock → backward check → layout/config moves → skills → `norn_version` last.
