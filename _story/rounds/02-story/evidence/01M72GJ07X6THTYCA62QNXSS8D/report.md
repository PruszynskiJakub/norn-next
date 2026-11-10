# QA gh-317 · qa #2 at HEAD a9321da29

Ran the dev CLI (`bun packages/cli/src/cli.ts` via norn.ts, version injected with QA_VERSION) in throwaway repos under the scratchpad; stub gh scripts for labels.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 harness config keeps the team file and its norn_version | pass | harness-runs.txt |  |
| 01.AC2 team keys written with the version first | pass | harness-runs.txt |  |
| 02.AC1 baseline rule: below 0.30 → version_too_old with the 0.30 path | pass | 02.AC1-AC2.txt |  |
| 02.AC2 baseline rule: missing → version_missing naming norn init | pass | 02.AC1-AC2.txt and noversion.txt |  |
| 02.AC3 0.29.4: tick/story start exit 3, nothing written | pass | v0294.txt |  |
| 02.AC4 no version: exit 3 version_missing; broken config still exit 6 | pass | noversion.txt |  |
| 02.AC5 help/doctor/init/upgrade not stopped by the guard; watch pauses | pass | v0294.txt, noversion.txt, watch-0294.txt, watch-mid.out |  |
| 02.AC6 status shows an Unblock item pointing to norn doctor | pass | v0294.txt, noversion.txt |  |
| 02.AC7 commit calls out the refusal and both codes | pass | 02.AC7.txt |  |
| 03.AC1 upgrade rewrites/relinks skills, version last, staged, commit printed | pass | upgrade.txt |  |
| 03.AC2 interrupted upgrade finishes on rerun | pass | 03.AC2.txt |  |
| 03.AC3 missing labels created; unreachable remote reported | pass | 03.AC3.txt, fakegh*.log |  |
| 03.AC4 current repo: nothing to upgrade; skills-only commit | pass | upgrade.txt |  |
| 03.AC5 version_backward / not_main_checkout / tick_locked, nothing changes | pass | upgrade.txt (binary 0.30.5 vs repo 0.31.0 → version_backward), 03.AC5.txt (tick lock held by another process → tick_locked; linked worktree → not_main_checkout); exit 3 and no file changed each time |  |
| 03.AC6 upgrade on 0.29.4 → version_too_old | pass | v0294.txt |  |
| 03.AC7 upgrade with no version → version_missing naming norn init | pass | noversion.txt |  |
| 03.AC8 --json has exactly the five keys | pass | upgrade.txt, 03.AC9.txt |  |
| 03.AC9 old key, needs, .gitattributes left alone; no norn upgrade hint | pass | 03.AC9.txt |  |
| 03.AC10 norn migrate unknown and absent from help | pass | 03.AC10.txt |  |
| 03.AC11 docs describe upgrade from 0.30 on, nothing old; docs:emit clean | pass | 03.AC11-grep.txt, 03.AC11-docs-emit.txt |  |
| 03.AC12 commit calls out removed migrate and dropped --json fields | pass | 03.AC12.txt |  |
| 04.AC1 doctor's version check fails with the guard's code/text | pass | 04.AC1-json.txt, v0294.txt, noversion.txt |  |
| 04.AC2 init with no team file records the running norn | pass | init.txt |  |
| 04.AC3 init on no/pre-0.30 version → exit 3, nothing changed | pass | v0294.txt, noversion.txt |  |
| 04.AC4 init on 0.30+ behaves as before | pass | 04.AC4.txt |  |
| 05.AC1 pre-0.13 repo: acting command → version_missing, old files untouched | pass | 05.AC1.txt |  |
| 05.AC2 agent hook does not refuse on the layout | pass | 05.AC2.txt |  |
| 05.AC3 doctor: no layout key or text | pass | 05.AC3.txt, 05.AC3-doctor-r2.md |  |
| 06.AC1 branch-tree runs/ never changed; story moves on | pass | harness-runs.txt |  |
| 06.AC2 base-tree runs/: no status item or hint | pass | 06.AC2-AC3.txt |  |
| 06.AC3 doctor: no run-state section or key | pass | 06.AC2-AC3.txt, 05.AC3.txt |  |
| 06.AC4 only record-move golden/rule cases gone; snapshots, transcripts unchanged | person | 06.AC4.txt | transcript line in recovery-claim-lost.txt removed: person rules |

Note for a person (03.AC2): after an interrupted upgrade, the rerun stages only the config; the skill rewritten before the interruption is left unstaged, so the printed commit misses it unless the person stages it too.
