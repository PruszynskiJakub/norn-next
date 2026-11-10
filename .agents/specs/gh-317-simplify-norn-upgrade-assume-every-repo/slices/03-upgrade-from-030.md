---
id: gh-317/03
title: norn upgrade moves only a 0.30+ repo, and norn migrate goes
depends_on: [gh-317/02]
status: planned
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: test }
  - { id: AC11, verifier: agent }
  - { id: AC12, verifier: agent }
---

## Goal
`norn upgrade` does only what a 0.30+ repo needs (refresh and relink the bundled skills, record the new version last, stage, create labels), refuses an older or unversioned repo with the 0.30 path, reports a five-field `--json`, and `norn migrate` no longer exists.

## Scope
User stories: upgrade rewrites and relinks skills; version written last; staged not committed with the commit printed; labels created, unreachable remote reported; already-current no-op; older binary refused; main-checkout and tick-lock refusals; pre-0.30 and missing-version refusals; `norn migrate` unknown; the five-field `--json`; no key renames, `needs` strip or `.gitattributes` edit; docs describe upgrade from 0.30 on; release notes name the removals. Seams: S1 (S2's text). Out: doctor and init (04), the old layout elsewhere (05), branch-tree run state (06).

## Acceptance
- AC1 Given a repo at 0.30.x and a newer norn, when `norn upgrade` runs, then each bundled skill is rewritten from this norn's copy and linked into every configured agent's skill folder, `norn_version` becomes this norn's, everything is staged, nothing is committed, and `Upgrade norn to <v> (norn upgrade)` is printed as the commit to make. — verifier: test
- AC2 Given an upgrade interrupted after the skills but before the version, when `norn upgrade` runs again, then it finishes and records the new version. — verifier: test
- AC3 Given labels missing on the remote, when `norn upgrade` runs, then they are created (none edited or deleted); given a remote it cannot reach or write, then that is reported and the upgrade still succeeds. — verifier: test
- AC4 Given a repo whose version, skills and links already match, when `norn upgrade` runs, then it prints `already on norn <v>: nothing to upgrade`, stages nothing and its commit is null; given only the skills differ, the commit is `Refresh norn's skills (norn upgrade)`. — verifier: test
- AC5 Given a binary older than the repo's `norn_version`, or a run outside the main checkout, or a tick holding the lock, when `norn upgrade` runs, then it exits 3 with `version_backward`, `not_main_checkout` or `tick_locked` and nothing changes. — verifier: test
- AC6 Given a repo recording 0.29.4, when `norn upgrade` runs, then it exits 3 with `version_too_old` and the baseline rule's `do_instead` (install norn 0.30.x, run `norn upgrade`, commit, upgrade again), and nothing is staged or rewritten. — verifier: test
- AC7 Given a repo recording no `norn_version`, when `norn upgrade` runs, then it exits 3 with `version_missing`, a `do_instead` that also names `norn init`, and nothing staged or rewritten. — verifier: test
- AC8 Given `norn upgrade --json` succeeds, then its value has exactly the keys `norn_version` (`from`, `to`, `changed`), `skills` (`updated`, `linked`), `staged`, `commit` and `labels`, and no `moves`, `config`, `run_state` or `gitattributes`. — verifier: test
- AC9 Given a 0.30 repo whose config holds an old key name, whose slices and spec carry criteria `needs`, and whose `.gitattributes` holds a `runs/**` line, when `norn upgrade` runs, then none of those files change and none is staged; config validation still flags the old key, without telling the person to run `norn upgrade`. — verifier: test
- AC10 Given `norn migrate`, when it runs, then it fails as an unknown command like any other, and `norn help` lists no `migrate`. — verifier: test
- AC11 Given the README, `docs/`, the generated reference and `norn upgrade`'s help summary, when a reader looks up upgrade, then they read that it moves a repo's `norn_version` and bundled skills from 0.30 on, the 0.30 starting point is stated, and nothing mentions old config keys, the `needs` strip, `.gitattributes`, the archive-ref move or `norn migrate`; `bun run docs:emit` leaves no diff. — verifier: agent
- AC12 Given this slice's commits, when a person reads them for the release notes, then they call out the removed `norn migrate` and the dropped `upgrade --json` fields `moves`, `config`, `run_state`, `gitattributes`. — verifier: agent

## Checks
- `bun run test`
- `bun run typecheck`
- `bun run docs:emit && git diff --exit-code`

## Notes
D5 (every check before any write: main checkout, baseline, backward, tick lock), D8, D10 (what goes: the config migration and `needs` strip, the archive-ref move of base-tree run state, the `.gitattributes` edit, the move list, `migrateCommand`), D11. The upgrade's own use of the old layout goes here; the layout module itself goes in 05, so whichever lands second removes the last import. The tests that exist only for the removed migrations go with them (`upgrade-records`, the old-layout, rename, `needs` and `.gitattributes` cases in `upgrade.test.ts`, `toBaseRunState` if nothing else uses it).
