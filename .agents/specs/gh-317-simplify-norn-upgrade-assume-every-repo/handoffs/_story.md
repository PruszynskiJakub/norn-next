#### Goal

"Assume every repo starts at 0.30": upgrade only moves a repo from 0.30 on, a missing or pre-0.30 `norn_version` is refused everywhere with the 0.30 path, and the old migrations go.

#### Proof

All six slices are integrated. Unit tier (1726 pass) and typecheck are green at review #1. QA #1: 30/32 pass; the docs criterion was fixed after QA; the golden/transcript criterion awaits a person. Review #1: **changes_requested**, with 2 blocking findings (see Not proven yet). Findings file: this run's review findings.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| 01.AC1 | `h.config` with no team keys keeps the team file and its norn_version | test | `harness-config.test.ts` › "config with no team keys keeps the team file and its norn_version" |
| 01.AC2 | team keys are written with the recorded version, version first | test | `harness-config.test.ts` › "team keys are written with the norn_version, the version first" |
| 02.AC1 | baseline rule: below 0.30 → version_too_old with the 0.30 path; 0.30+ → nothing | test | `printed-commands.test.ts` |
| 02.AC2 | baseline rule: missing → version_missing naming norn init and the 0.30 path | test | `printed-commands.test.ts` |
| 02.AC3 | 0.29.4: tick and story start exit 3, nothing written/launched/pushed | test | `version-baseline.test.ts` › "tick and story start exit 3 …" |
| 02.AC4 | no version: exit 3 version_missing; a broken config is still exit 6 | test | `version-baseline.test.ts` › same + "a config that fails to load …" |
| 02.AC5 | help/doctor/init/upgrade not stopped by the guard; watch pauses | test | `version-baseline.test.ts` › "help and doctor are not stopped …" + "a tick after the team file loses its version is skipped …" |
| 02.AC6 | status shows an Unblock item with the rule's text and norn doctor | test | `version-baseline.test.ts` › "norn status shows an Unblock item …" |
| 02.AC7 | commits call out the refusal and both codes | agent | QA (agent) (commit 5e8451d29) |
| 03.AC1 | upgrade rewrites/relinks skills, version last, staged, commit printed | test | `upgrade-version.test.ts` › "0.30.0 with a drifted skill and a missing link → …" |
| 03.AC2 | an interrupted upgrade finishes on rerun | test | `upgrade-version.test.ts` › "interrupted after the skills, before the version …" |
| 03.AC3 | missing labels created; unreachable remote reported, upgrade succeeds | test | `labels.test.ts` › "B2, B4, B7 …" + "B14: a failed listing …" |
| 03.AC4 | current repo: nothing to upgrade; skills-only → Refresh norn's skills | test | `upgrade-version.test.ts` › "… already on norn 0.31.0 …" + "only a skill differs …" |
| 03.AC5 | version_backward, not_main_checkout, tick_locked, nothing changed | test | `upgrade-version.test.ts` › "binary 0.30.5, repo at 0.31.0 …"; `upgrade.test.ts` › tick lock + linked worktree cases |
| 03.AC6 | upgrade on 0.29.4 → version_too_old, nothing staged | test | `upgrade.test.ts` › "a repo recording 0.29.4: version_too_old …" |
| 03.AC7 | upgrade with no version → version_missing naming norn init | test | `upgrade.test.ts` › "a repo recording no norn_version: version_missing …" |
| 03.AC8 | `--json` has exactly the five keys | test | `upgrade.test.ts` › "holds exactly norn_version …, skills …, staged, commit and labels" |
| 03.AC9 | old key, needs, .gitattributes left alone; validation flags the key without norn upgrade | test | `upgrade.test.ts` › "none of those files change …" + "with a valid config …" |
| 03.AC10 | norn migrate unknown and absent from help | test | `upgrade.test.ts` › "it fails as an unknown command …"; `help-tree.test.ts` |
| 03.AC11 | docs describe upgrade from 0.30 on, nothing old | agent | QA (agent): re-check after the docs fix |
| 03.AC12 | commits call out removed migrate and dropped --json fields | agent | QA (agent) (commit b45b051f0) |
| 04.AC1 | doctor's version check fails with the guard's code/error/do_instead | test | `version-baseline.test.ts` › "doctor's version check fails …" |
| 04.AC2 | init with no team file records the running norn | test | `init-version.test.ts` › "AC1 B1: a repo with no norn_version gets the binary's …" |
| 04.AC3 | init on no/pre-0.30 version → exit 3, no file changed | test | `version-baseline.test.ts` › "init exits 3 with {code} …" |
| 04.AC4 | init on 0.30+ behaves as today | test | `init-version.test.ts` › "AC2 B28 …" |
| 05.AC1 | pre-0.13 repo: acting command → version_missing, old files untouched | test | `pre-013-repo.test.ts` › "an acting command exits 3 with version_missing …" |
| 05.AC2 | agent hook does not refuse on the layout | test | `pre-013-repo.test.ts` › "an agent hook … does not refuse on the layout" (weak: also passes on old code) |
| 05.AC3 | doctor: no layout section/key, no old-layout or migrate text | test | `pre-013-repo.test.ts` › "a pre-0.13 repo: no layout key …" |
| 06.AC1 | runs/ in a branch tree never changed; story moves on | test | `branch-tree-run-state.test.ts` › "ticks leave the branch tree as it is …" |
| 06.AC2 | base-tree runs/: no status item or hint | test | `archive-ref.test.ts` › "run list is empty for it, no status item or hint …" |
| 06.AC3 | doctor: no run-state section or key | test | `archive-ref.test.ts` › same test |
| 06.AC4 | only record-move golden/rule cases gone; snapshots, transcripts unchanged | test | golden corpus (`golden.test.ts`); one transcript line removed, a person rules |

Every user story is covered by the criteria above; none is UNTRACED.

#### Easy to miss

- Fixes keep the guard as it is: fix docs, dead code and fixtures, never weaken the refusal.
- F1's verify grep: `grep -rnw 'repoLayout\|layoutProblems\|layoutRefusal\|OLD_CONFIG_FILE\|OLD_TRACE_DIR\|OLD_WORKFLOWS_DIR\|OLD_NORN_DIR\|toOldLayout' packages test` must find nothing. Tests that use OLD_* spell the paths as literals.

#### Not proven yet

- **Blocking F1** (old-layout code the plan's D10 removes is still there, dead): `packages/store/src/layout.ts` + its export in `store/src/index.ts:15`, `OLD_*` in `store/src/paths.ts:24-27`, `packages/cli/src/runtime/layout.ts` (no callers), `toOldLayout` in `test/support/harness.ts:459`, `docs/development.md:26` "layout.ts (old/new/both)".
- **Blocking F2**: `packages/cli/src/commands/config.ts:112` tells a person that `norn upgrade` records a missing norn_version, but upgrade now refuses that repo with version_missing. Reword it to point at `norn init` or the 0.30 path, and update `config.test.ts` › "B4: without the key, get shows no value and that norn upgrade records it".
- QA has not re-checked 03.AC11 (docs) since the docs fix; a person has not ruled on 06.AC4's one-line transcript change.
- The integration and e2e tiers run in CI only.

#### Notes

- Minor notes from review #1 for the person, not rework: init's version_missing hint loops back to init (`core/src/commands.ts:178`); upgrade checks the baseline before loading config, so a broken config with no version gets exit 3, not 6 (D4, `upgrade.ts:52`); `treeRecordCommit`/`treeStoryRunStatePath`/`GitPort.move` are left for tests only; the 05.AC2 hook test also passes on old code; stale comments (`observe/index.ts:522`, `view/src/load.ts:474`, `store/src/fsx.ts:16`, `docs/limitations.md:29`); commit 1ac2a0d2f's accepted risk (a branch-only record reads as none) belongs in the PR body.
- Earlier decisions (person): init refuses a pre-0.30 version too; config old-key messages lose their "run `norn upgrade`" hint; codes `version_missing` / `version_too_old`; the status version item is an Unblock item pointing to `norn doctor`. Flat records and older `state.json` readers stay (out of scope).
- Release notes come from commits 5e8451d29 and b45b051f0 and the PR body. CHANGELOG is the release step's.

#### Resume

Implement: fix F1 (delete the dead old-layout code and its doc mention) and F2 (the config null-meaning text and its test), then run `bun run test` and `bun run typecheck`.
