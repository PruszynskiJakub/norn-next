# QA gh-317 · qa #5 at HEAD adb5b5a74

Every criterion re-observed on the current HEAD (since QA #4: the merge of main that moved unit worktrees into the machine dir). Dev CLI driven through `norn.ts` → `packages/cli/src/cli.ts` (binary version injected with QA_VERSION, NORN_HOME_DIR in the scratchpad, wrapper `n`, change detector `r`), in throwaway repos under `$QA/w` (`$QA` = this session's scratchpad qa5 dir): g-0.29.4 / g-none / bc / wt (guard), up1 / int / ac9 (upgrade), i1 / ac44 (init), r3 (pre-0.13 only), br (base tree holds runs/ copied from a real round), r7 (triage story with a bare local remote seeded by `git clone --bare`, stub `gh` serving issue #1, stub `claude`, no herdr on PATH). Labels used a stub `gh` listing only `norn` (or failing with FAKEGH=down). Stubs in `stubs/`.

Two fixture mistakes of mine were redone and their outputs kept for the record: `06.AC1-discarded-fixture-error.txt` (empty glob aborted my runs/ commit) and `06.AC2-invalid-fixture-discarded.txt` (spec without `slug`). The first tick_locked attempt held the lock in a different machine dir; 03-upgrade.txt has only the redone case.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 harness config with no team keys keeps the team file and its norn_version | pass | 01-harness.txt | |
| 01.AC2 team keys written with the version first | pass | 01-harness.txt | |
| 02.AC1 baseline rule: below 0.30 → version_too_old with the 0.30 path; 0.30+ → nothing | pass | 02.AC1-AC2-rule.txt | |
| 02.AC2 baseline rule: missing → version_missing naming norn init and the 0.30 path | pass | 02.AC1-AC2-rule.txt, guard-none.txt | |
| 02.AC3 0.29.4: tick, story start (and sync) exit 3, nothing written | pass | guard-0.29.4.txt | repo, ignored files and machine dir unchanged |
| 02.AC4 no version: exit 3 version_missing; invalid YAML still exit 6 config_invalid | pass | guard-none.txt, 02.AC4-broken-config.txt | |
| 02.AC5 help/doctor not stopped by the guard; watch pauses ticks | pass | guard-*.txt, 02.AC5-watch.txt | watch: 3 ticks, then 3 refused, skipped_version 3 |
| 02.AC6 status shows an Unblock item with the rule's text and `norn doctor` | pass | guard-*.txt | |
| 02.AC7 commit calls out the refusal and both codes | pass | 02.AC7-03.AC12-commits.txt | 5e8451d29 on HEAD |
| 03.AC1 upgrade rewrites/relinks skills, version, staged, nothing committed, commit printed | pass | 03-upgrade.txt | |
| 03.AC2 interrupted upgrade finishes on rerun | pass | 03.AC2.txt | see note |
| 03.AC3 missing labels created (list + create only); unreachable remote reported, upgrade succeeds | pass | 03-upgrade.txt | |
| 03.AC4 current repo: "already on norn …: nothing to upgrade", commit null; skills-only commit wording | pass | 03-upgrade.txt | |
| 03.AC5 version_backward / not_main_checkout / tick_locked, exit 3, nothing changes | pass | 03-upgrade.txt, 03.AC5-not-main.txt | not_main_checkout in the machine-dir worktree norn made in r7 |
| 03.AC6 upgrade on 0.29.4 → version_too_old, nothing staged | pass | guard-0.29.4.txt | |
| 03.AC7 upgrade with no version → version_missing naming norn init | pass | guard-none.txt | |
| 03.AC8 --json holds exactly the five keys | pass | 03-upgrade.txt | |
| 03.AC9 needs / .gitattributes / old key left alone; validation flags the key with no norn upgrade hint | pass | 03.AC9.txt | |
| 03.AC10 norn migrate unknown (exit 2 unknown_command) and absent from help | pass | 03.AC10.txt | |
| 03.AC11 docs describe upgrade from 0.30 on, nothing old; docs:emit leaves no diff | pass | 03.AC11-grep.txt, 03.AC11-docs-emit.txt, 03.AC10.txt | |
| 03.AC12 commit calls out removed migrate and the dropped --json fields | pass | 02.AC7-03.AC12-commits.txt | b45b051f0 on HEAD |
| 04.AC1 doctor's version check fails (ok:false) with the guard's code/error/do_instead | pass | guard-*.txt | |
| 04.AC2 init with no team file records the running norn | pass | 04.AC2-init.txt | |
| 04.AC3 init on no/pre-0.30 version → exit 3, no file changed | pass | guard-*.txt | |
| 04.AC4 init on 0.30+ keeps the version and a differing skill, names norn upgrade | pass | 04.AC4.txt | |
| 05.AC1 pre-0.13 repo: acting command → version_missing, old files untouched | pass | 05.AC1.txt | |
| 05.AC2 agent hook does not refuse on the layout | pass | 05.AC2.txt | |
| 05.AC3 doctor: no layout key/section, no old-layout or migrate text | pass | 05.AC3-06.AC3-doctor.txt, 05-old-layout-grep.txt | |
| 06.AC1 branch-tree runs/ never changed by ticks; story moves on from machine-dir state | pass | 06.AC1-setup.txt, 06.AC1.txt | runs/ tree hash identical at QA commit, local tip and remote tip; story reached done |
| 06.AC2 base-tree runs/: no status item or hint; run list empty | pass | 06.AC2.txt | |
| 06.AC3 doctor: no run-state section or key | pass | 05.AC3-06.AC3-doctor.txt, 06.AC2.txt | |
| 06.AC4 only the record-move golden/rule cases gone; snapshots, transcripts unchanged | person | 06.AC4.txt | same two changes ruled at human-qa#1/#2/#3: one transcript probe line gone; snapshots' version fields 0.19.0→0.30.0 |

Note (03.AC2, seen again): after an interrupted upgrade, the rerun stages only the config. The skill rewritten before the interruption is left unstaged, so the printed commit misses it unless the person stages it too.
