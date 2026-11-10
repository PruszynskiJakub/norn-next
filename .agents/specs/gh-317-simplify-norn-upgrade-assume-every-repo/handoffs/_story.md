#### Goal

"Assume every repo starts at 0.30": upgrade only moves a repo from 0.30 on, a missing or pre-0.30 `norn_version` is refused everywhere with the 0.30 path, and the old migrations go.

#### Proof

All six slices are integrated. Review #5 at 81146c3ee (after the main merge d6e49dc7f): approve, no findings; test#5 (unit tier + typecheck) green. **QA #5 at adb5b5a74: 31/32 pass, every criterion re-observed with the dev CLI in throwaway repos** (qa#5 evidence: `report.md`, scripts `n`/`r`/`mk.sh`/`norn.ts`). The golden/transcript criterion (06.AC4) is `person`.

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
| 03.AC11 | docs describe upgrade from 0.30 on, nothing old | agent | QA (agent) |
| 03.AC12 | commits call out removed migrate and dropped --json fields | agent | QA (agent) (commit b45b051f0) |
| 04.AC1 | doctor's version check fails with the guard's code/error/do_instead | test | `version-baseline.test.ts` › "doctor's version check fails …" |
| 04.AC2 | init with no team file records the running norn | test | `init-version.test.ts` › "AC1 B1: a repo with no norn_version gets the binary's …" |
| 04.AC3 | init on no/pre-0.30 version → exit 3, no file changed | test | `version-baseline.test.ts` › "init exits 3 with {code} …" |
| 04.AC4 | init on 0.30+ behaves as today | test | `init-version.test.ts` › "AC2 B28 …" |
| 05.AC1 | pre-0.13 repo: acting command → version_missing, old files untouched | test | `pre-013-repo.test.ts` › "an acting command exits 3 with version_missing …" |
| 05.AC2 | agent hook does not refuse on the layout | test | `pre-013-repo.test.ts` › "an agent hook … does not refuse on the layout" |
| 05.AC3 | doctor: no layout section/key, no old-layout or migrate text | test | `pre-013-repo.test.ts` › "a pre-0.13 repo: no layout key …" |
| 06.AC1 | runs/ in a branch tree never changed; story moves on | test | `branch-tree-run-state.test.ts` › "ticks leave the branch tree as it is …" |
| 06.AC2 | base-tree runs/: no status item or hint | test | `archive-ref.test.ts` › "run list is empty for it, no status item or hint …" |
| 06.AC3 | doctor: no run-state section or key | test | `archive-ref.test.ts` › same test |
| 06.AC4 | only record-move golden/rule cases gone; snapshots, transcripts unchanged | test | golden corpus (`golden.test.ts`); one transcript line removed, a person rules |

Every user story is covered; none UNTRACED.

#### Easy to miss

- Fixes keep the guard as it is: fix docs, dead code and fixtures, never weaken the refusal.
- No old-layout code comes back: `grep -rnw 'repoLayout\|layoutProblems\|layoutRefusal\|OLD_CONFIG_FILE\|OLD_TRACE_DIR\|OLD_WORKFLOWS_DIR\|OLD_NORN_DIR\|toOldLayout' packages test` finds nothing. Tests name the pre-0.13 place through the harness's `PRE_013_NORN_DIR`.

#### Not proven yet

- Golden/transcript criterion (06.AC4: only the record-move golden cases gone, pinned outputs otherwise unchanged), `person`: ruled acceptable at human-qa#1–#4; QA #5's `06.AC4.txt` shows the same diff (four run-state-move golden cases, one branch-tree runs/ probe line in `recovery-claim-lost.txt`, observe snapshots' version fields 0.19.0 → 0.30.0).

#### Notes

- Review #1 minor notes (for the person, not rework): init's version_missing hint loops back to init (`core/src/commands.ts:178`); upgrade checks the baseline before config, so a broken config with no version gets exit 3, not 6 (`upgrade.ts:52`); test-only leftovers `treeRecordCommit`/`treeStoryRunStatePath`/`GitPort.move`; a few stale comments. The accepted risk (a branch-only record reads as none) is in the PR body.
- Person decisions: init refuses pre-0.30 too; config old-key messages drop the `norn upgrade` hint; codes `version_missing`/`version_too_old`; status version item is Unblock → `norn doctor`. Flat records and old `state.json` readers stay.
- QA note (03.AC2, seen again at QA #5): an interrupted upgrade's rerun stages only the config; a skill rewritten before the interruption stays unstaged.
- CI fixes: fixtures record `norn_version` (`runningVersion(h.deps)` / `h.recordVersion()`); guard unchanged. CI tests the PR merged with main, so a new main fixture that skips `norn init` (as `merged-pr.test.ts` did) needs `h.recordVersion()`; check main's new tests after a merge. The reverse also bites: here `norn init` already records the version and `h.config` keeps it, so a main test that runs `h.recordVersion()` and then commits only that has an empty commit and fails (`worktrees-machine-dir.test.ts` › "worktrees follow the clone and its home", fixed by dropping that redundant block).
- Release notes come from commits 5e8451d29 and b45b051f0 and the PR body. CHANGELOG is the release step's.
- Friction: the agent hook refuses `git worktree add`/`git push` even in a $TMPDIR QA repo.

#### Resume

implement#6 fixed CI's one failure (the empty version-only commit in `worktrees-machine-dir.test.ts`; that file now passes 10/10 locally, plus the unit tier and typecheck). Shards 3/4 and 4/4 were cancelled in that CI run and have not run on this head. Next: review, test, QA, then CI.
