### Goal

`norn upgrade` does only what a 0.30+ repo needs: refresh and relink the bundled skills, write `norn_version` last, stage, create labels. It refuses an older or unversioned repo with the 0.30 path and reports a five-field `--json`. `norn migrate` is gone.

### Proof

Commit b45b051f0, plus the review #1 rework commit on top. Unit tier 1736 pass, `bun run typecheck` green, `bun run docs:emit` leaves no diff after the rework.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | skills rewritten and relinked, version moved, all staged, nothing committed, the commit printed | test | `upgrade-version.test.ts` › "0.30.0 with a drifted skill and a missing link → both fixed…"; "an agent folder the repo ignores…" |
| AC2 | an upgrade cut short after the skills records the version on a rerun | test | `upgrade-version.test.ts` › "interrupted after the skills, before the version → a rerun records the new version" |
| AC3 | missing labels created, never edited; an unreachable remote reported, upgrade still succeeds | test | `labels.test.ts` › "norn upgrade creates what is missing, on every run" (B2/B4/B7, B14) |
| AC4 | already current: "already on norn <v>: nothing to upgrade", nothing staged, commit null; only skills differ: Refresh commit | test | `upgrade-version.test.ts` › "binary 0.31.0, repo at 0.31.0…"; "only a skill differs…" |
| AC5 | `version_backward`, `not_main_checkout`, `tick_locked` refused, exit 3, nothing changed | test | `upgrade-version.test.ts` › "binary 0.30.5, repo at 0.31.0…"; `upgrade.test.ts` › "while watch holds the tick lock…", "in a linked worktree…" |
| AC6 | 0.29.4 refused `version_too_old` with the 0.30.x path, nothing changed | test | `upgrade.test.ts` › "a repo recording 0.29.4…" |
| AC7 | no version refused `version_missing`, do_instead names `norn init`, nothing changed | test | `upgrade.test.ts` › "a repo recording no norn_version…", "a repo with only the pre-0.13 config file…" |
| AC8 | `--json` has exactly norn_version, skills, staged, commit, labels | test | `upgrade.test.ts` › "norn upgrade --json" › "holds exactly…" |
| AC9 | no key rename, `needs` strip or `.gitattributes` edit; validation flags the old key without naming upgrade | test | `upgrade.test.ts` › "norn upgrade leaves old config keys, criteria needs and .gitattributes alone" (2 tests); `config.test.ts` › B39 |
| AC10 | `norn migrate` an unknown command, absent from help | test | `upgrade.test.ts` › "norn migrate is gone"; `help-tree.test.ts` |
| AC11 | README, docs, reference and help describe upgrade from 0.30 on, nothing old | agent | QA (agent). Rework fixed README.md:77 (an old config key is fixed in its file; upgrade moves from 0.30 on, otherwise the 0.30.x path) and docs/development.md:26 (dropped old-layout.ts and migrate's moves) |
| AC12 | the commits call out the removed `norn migrate` and the dropped `--json` fields | agent | QA (agent). Commit b45b051f0 has a "Release note:" list naming both and the 0.30 path |

Review #1, finding 3 (the `needs_removed` advice): `agent-protocol.test.ts` › "a spec whose criteria still carry needs: brief refuses with the file to fix, not norn upgrade"; `markdown-unit.test.ts` › B38; `config-runtime.test.ts` › B38 (inbox item: title names the file, command `norn run view <slice> --why`).

### Easy to miss

- Upgrade's order (D5): main checkout, baseline (read from the team file, so a config that fails to load still gets the 0.30 path), backward, config load (exit 6), tick lock. A config with an old key makes upgrade exit 6 with nothing written.
- `configError` (`packages/cli/src/output.ts`) gives `fix <file>` for `config_moved`, no longer `norn upgrade`.
- `Command.layout`/`layout: false` stays on upgrade; slice 05 removes the layout guard and the field.

### Not proven yet

- The integration and e2e tiers as a whole have not run locally (only agent-protocol and config-runtime integration files were run, both green). `test/e2e/base-sync.test.ts` (around line 698) sets up repos at 0.18.0/0.19.0, which slice 02's guard refuses; CI will show it.

### Notes

- Removed: `config-migrate.ts`, `old-layout.ts` (`moveFile` now in `fsx.ts`), `archiveBaseRunState`/`BaseRecordOutcome` (`treeRecordCommit` stays for the harness), `oldTickLockPath`, the harness's `toBaseRunState`, `upgrade-records.test.ts`. The `OLD_*` paths and `repoLayout` stay for slice 05.
- The layout guard (`packages/cli/src/runtime/layout.ts`) still points to `norn upgrade`; slice 05 removes it.
- `needs_removed`: `needsRemovedMessage(kind, key, file)` now ends "delete it from the criteria in <file>"; brief/done refuse with `do_instead: fix <file>`; the inbox items (spec and slice) use `norn run view <key> --why`, like a corrupt file, since an inbox command must be a shell command.

### Resume

Review the rework commit (README.md:77, docs/development.md:26, the `needs_removed` message and do_instead).
