---
id: gh-317/04
title: doctor's version check and init apply the 0.30 baseline
depends_on: [gh-317/02]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
---

## Goal
`norn doctor` fails its version check on a repo with no or a pre-0.30 `norn_version` with the same words as the guard, and `norn init` refuses to stamp such a repo current, while a new repo and a 0.30+ repo behave as today.

## Scope
User stories: doctor's version check agrees with the guard; init on no team file records the version; init on a team file with no or a pre-0.30 version refused; init on a 0.30+ team file behaves as today. Seams: S1 (S2's text). Out: doctor's layout and run-state sections (05, 06).

## Acceptance
- AC1 Given a repo recording no `norn_version`, or 0.29.4, when `norn doctor` runs (markdown and `--json`), then its version check fails (`ok: false`, not a warning) with code `version_missing` or `version_too_old` and the guard's error and `do_instead`. — verifier: test
- AC2 Given a repo with no team file, when `norn init` runs, then it creates the team file recording the running norn as `norn_version`. — verifier: test
- AC3 Given a team file that exists with no `norn_version`, or with 0.29.4, when `norn init` runs, then it exits 3 with `version_missing` or `version_too_old` and the 0.30 path as `do_instead`, and no file changes. — verifier: test
- AC4 Given a team file recording a version from 0.30 on, when `norn init` runs, then it never moves the version, leaves a differing bundled skill and names `norn upgrade`, as today. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D6, D9 (the version part only). init's refusal runs before any write. The guard (02) already lets doctor and init through; this slice gives them their own check.
