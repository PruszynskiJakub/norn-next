### Goal

`norn upgrade` does only what a 0.30+ repo needs: refresh and relink the bundled skills, write `norn_version` last, stage, create labels. It refuses an older or unversioned repo with the 0.30 path and reports a five-field `--json`. `norn migrate` is gone.

### Proof

Commit b45b051f0. The unit tier passes (1736), as does `bun run typecheck`, and `bun run docs:emit` leaves no diff. The touched integration files run on their own pass (154): upgrade, upgrade-version, version-baseline, help-tree, version-guard, config, config-runtime, labels, layout-guard, records, round-folders.

- AC1 (skills rewritten and relinked, version moved, all staged, commit printed): `upgrade-version.test.ts` › "0.30.0 with a drifted skill and a missing link → both fixed…"; "an agent folder the repo ignores…"
- AC2 (interrupted after the skills, a rerun records the version): `upgrade-version.test.ts` › "interrupted after the skills, before the version…"
- AC3 (labels created; an unreachable remote is reported): the existing `labels.test.ts` › "norn upgrade creates what is missing, on every run" (B2, B4, B7, B14), unchanged and passing
- AC4 (already current: no-op; skills only: Refresh commit): `upgrade-version.test.ts` › "binary 0.31.0, repo at 0.31.0…" and "only a skill differs…"
- AC5 (`version_backward`, `not_main_checkout`, `tick_locked`): `upgrade-version.test.ts` › "binary 0.30.5, repo at 0.31.0…"; `upgrade.test.ts` › "while watch holds the tick lock…" and "in a linked worktree…"
- AC6 (0.29.4 refused with `version_too_old`): `upgrade.test.ts` › "a repo recording 0.29.4…"
- AC7 (no version refused with `version_missing`): `upgrade.test.ts` › "a repo recording no norn_version…" and "a repo with only the pre-0.13 config file…"; `version-baseline.test.ts` › "help, doctor, init and upgrade are not stopped by the guard; upgrade refuses on its own…"
- AC8 (the five-field `--json`): `upgrade.test.ts` › "norn upgrade --json" › "holds exactly…"
- AC9 (no key rename, `needs` strip or `.gitattributes` edit): `upgrade.test.ts` › "norn upgrade leaves old config keys, criteria needs and .gitattributes alone" (2 tests); `config.test.ts` › "B39: an old key is config_moved naming its replacement, do_instead to fix that file"
- AC10 (`norn migrate` unknown, gone from help): `upgrade.test.ts` › "norn migrate is gone"; `help-tree.test.ts` (SETUP list); `reference.test.ts`; `version-class.test.ts`
- AC11 (docs): `docs/recipes.md` "Roll out a new norn to a team" rewritten with the 0.30 starting point. `docs/reference.md` regenerated, and its tick-lock sentence names `norn upgrade` in place of `norn migrate`. The help summary reads "Move this repo's norn_version and bundled skills to this norn, from norn 0.30 on, staged for you to commit".
- AC12 (release notes): commit b45b051f0's message has a "Release note:" list naming the removed `norn migrate`, the dropped `moves`/`config`/`run_state`/`gitattributes` and the 0.30 path.

### Easy to miss

- Upgrade's order (D5): main checkout, then the baseline (read from the team file itself, so a config that fails to load still gets the 0.30 path), then backward, then config load (exit 6), then the tick lock. A config with an old key now makes upgrade exit 6 with nothing written. Before, it renamed the key.
- `configError` in `packages/cli/src/output.ts` no longer gives `do_instead: norn upgrade` for `config_moved`. It gives `fix <file>`, as for every other config problem.
- `Command.layout`/`layout: false` stays on upgrade. Slice 05 removes the layout guard and the field.

### Not proven yet

- The new tests were written after the code, not seen red first. Each one asserts something the old code broke: the old `--json` keys, upgrade of a 0.29.4 or unversioned repo, `migrate` as a command, config key renames and the `needs` strip.
- The integration and e2e tiers as a whole were not run locally. `test/e2e/base-sync.test.ts` (around line 698) still sets up repos at 0.18.0/0.19.0, which slice 02's baseline guard refuses. That is slice 02's churn, for CI to show.

### Notes

- Removed: `packages/store/src/config-migrate.ts` (`migrateConfig`), `packages/store/src/old-layout.ts` (`moveFile` moved to `fsx.ts`; lifecycle uses it), `archiveBaseRunState`/`BaseRecordOutcome` in `record-ref.ts` (`treeRecordCommit` stays: the harness's `archiveTreeRunState` uses it), `oldTickLockPath`, the harness's `toBaseRunState`, `upgrade-records.test.ts`, and the old-layout, migrate and config-key cases of `upgrade.test.ts`. The `OLD_*` paths and `repoLayout` stay for slice 05.
- Left as is, outside these criteria: `needsRemovedMessage` (`packages/schema/src/criteria.ts`) still says "run `norn upgrade`", and `agent-unit.ts` refuses `needs_removed` with `do_instead: norn upgrade`. Upgrade no longer strips `needs`, so that pointer now leads nowhere. It needs a person's call (e.g. "delete `needs` from the criteria").
- The layout guard (`packages/cli/src/runtime/layout.ts`) still points to `norn upgrade`. Slice 05 removes it.

### Resume

Implementation is done and committed. Next: review against AC1–AC12. For AC11, read `docs/recipes.md` "Roll out a new norn to a team" and `docs/reference.md`. For AC12, read commit b45b051f0's message.
