### Goal

`norn upgrade` does only what a 0.30+ repo needs: refresh and relink the bundled skills, write `norn_version` last, stage, create labels. It refuses an older or unversioned repo with the 0.30 path and reports a five-field `--json`. `norn migrate` is gone.

### Proof

Commit b45b051f0. Review #1 reran the unit tier (1736 pass) and `bun run typecheck` (green); `bun run docs:emit` leaves no diff.

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
| AC11 | README, docs, reference and help describe upgrade from 0.30 on, nothing old | agent | QA (agent). Review found README.md:77 and docs/development.md:26 still out of date (findings F1, F2) |
| AC12 | the commits call out the removed `norn migrate` and the dropped `--json` fields | agent | QA (agent). Commit b45b051f0 has a "Release note:" list naming both and the 0.30 path |

Findings: `$TMPDIR/gh317-03-review/findings.json` (passed to norn with `--findings`).

### Easy to miss

- Upgrade's order (D5): main checkout, baseline (read from the team file, so a config that fails to load still gets the 0.30 path), backward, config load (exit 6), tick lock. A config with an old key makes upgrade exit 6 with nothing written.
- `configError` (`packages/cli/src/output.ts`) gives `fix <file>` for `config_moved`, no longer `norn upgrade`.
- `Command.layout`/`layout: false` stays on upgrade; slice 05 removes the layout guard and the field.

### Not proven yet

Rework from review #1 (all blocking):
- F1, docs (AC11): README.md:77 still says a repo set up by an older norn, or a config with old keys, should run `norn upgrade`, which now fixes neither. Rewrite it: an old key is fixed in its file, and a repo with no or a pre-0.30 version takes the 0.30.x path.
- F2, docs (AC11): docs/development.md:26 lists the deleted `old-layout.ts` and "migrate's moves".
- F3, wrong advice: the `needs_removed` refusal (`packages/cli/src/runtime/agent-unit.ts:130`, message from `packages/schema/src/criteria.ts:26`, shown by `packages/core/src/inbox/items.ts:23`) still says run `norn upgrade`, which no longer strips `needs`. Point it at deleting `needs` from the criteria, as D11 did for config keys, and test it.
- The integration and e2e tiers as a whole have not run locally. `test/e2e/base-sync.test.ts` (around line 698) sets up repos at 0.18.0/0.19.0, which slice 02's guard refuses; CI will show it.

### Notes

- Removed: `config-migrate.ts`, `old-layout.ts` (`moveFile` now in `fsx.ts`), `archiveBaseRunState`/`BaseRecordOutcome` (`treeRecordCommit` stays for the harness), `oldTickLockPath`, the harness's `toBaseRunState`, `upgrade-records.test.ts`. The `OLD_*` paths and `repoLayout` stay for slice 05.
- The layout guard (`packages/cli/src/runtime/layout.ts`) still points to `norn upgrade`; slice 05 removes it.

### Resume

Fix F1–F3 under Not proven yet. Then run `bun run test`, `bun run typecheck` and `bun run docs:emit` (expect no diff), commit, and report.
