# QA #6 gh-317 at 67c548055: assume every repo starts at norn 0.30

Run through the dev CLI in throwaway repos (see README-setup.md). Worst verdict: **person** (the pinned-output criterion).

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 harness config without team keys keeps the recorded norn_version | pass | 01-harness.md | |
| 01.AC2 harness config with team keys writes them after norn_version | pass | 01-harness.md | |
| 02.AC1 baseline rule on 0.29.4: version_too_old, its text, the 0.30.x path; 0.30+ gets nothing | pass | 02-rule.md, 02-guard-2.md | |
| 02.AC2 baseline rule on no version: version_missing, names norn init | pass | 02-rule.md | |
| 02.AC3 acting commands on 0.29.4 exit 3 and change nothing | pass | 02-guard.md | |
| 02.AC4 acting commands on no version exit 3; a broken config is still exit 6 | pass | 02-guard.md, 02-guard-2.md | |
| 02.AC5 help/doctor/init/upgrade not stopped by the guard; watch pauses | pass | 02-guard-2.md, 02-04-doctor-watch.md | watch refuses at start and skips ticks mid-run |
| 02.AC6 status shows an Unblock item pointing to norn doctor | pass | 02-guard-2.md | |
| 02.AC7 release note names the refusal and both codes | pass | 02.AC7-03.AC12-commits.md | |
| 03.AC1 upgrade rewrites/relinks skills, moves version, stages, prints commit | pass | 03-upgrade.md | |
| 03.AC2 interrupted upgrade finishes on rerun | pass | 03-upgrade.md | a skill rewrite left uncommitted stays unstaged on the rerun |
| 03.AC3 missing labels created; unreachable remote reported, upgrade succeeds | pass | 03-labels.md | stub gh |
| 03.AC4 already current: nothing to upgrade; skills only: Refresh commit | pass | 03-upgrade.md | |
| 03.AC5 version_backward, not_main_checkout, tick_locked refusals | pass | 03-refusals.md | |
| 03.AC6 upgrade on 0.29.4 refused with the 0.30 path | pass | 02-guard-2.md | |
| 03.AC7 upgrade on no version refused, names norn init | pass | 02-guard-2.md | |
| 03.AC8 upgrade --json has exactly five fields | pass | 03-upgrade.md | |
| 03.AC9 old key, needs, .gitattributes untouched; old-key message names no upgrade | pass | 03-old-files-migrate.md | |
| 03.AC10 norn migrate is an unknown command, not in help | pass | 03-old-files-migrate.md | |
| 03.AC11 docs describe upgrade from 0.30 on, nothing about removed migrations | pass | 03-AC11-docs.md | docs:emit no diff |
| 03.AC12 release note names migrate removal and dropped --json fields | pass | 02.AC7-03.AC12-commits.md | |
| 04.AC1 doctor's version check fails with the guard's words | pass | 02-guard-2.md, 02-04-doctor-watch.md | |
| 04.AC2 init with no team file records the running version | pass | 04-init.md | |
| 04.AC3 init on a no/pre-0.30 team file refused, nothing written | pass | 04-init.md, 02-guard-2.md | |
| 04.AC4 init on 0.30+ keeps version and differing skills, names upgrade | pass | 04-init.md | |
| 05.AC1 pre-0.13 repo refused version_missing, old files untouched | pass | 05-layout.md | |
| 05.AC2 hooks do not refuse on the layout | pass | 05-layout.md | |
| 05.AC3 doctor has no layout section, no migrate mention | pass | 05-layout.md | |
| 06.AC1 runs/ in a story branch tree never changed; story moves on | pass | 06-AC1.md | |
| 06.AC2 runs/ in the base tree: status says nothing | pass | 06-base-runs.md | |
| 06.AC3 doctor has no run-state section | pass | 06-base-runs.md | |
| 06.AC4 golden: only record-move cases gone; snapshots/transcripts unchanged | person | 06-AC4-golden.md | same diff as ruled at human-qa #1–#4 |

Process note: `bun run golden` without `--update` is the harvest mode (it adds corpus cases), not a check. It was started by mistake and stopped within two minutes; the worktree was clean afterwards. The replay went through `golden.test.ts` instead.
