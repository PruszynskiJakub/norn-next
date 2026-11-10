# QA gh-317: assume every repo starts at norn 0.30

Run through the dev CLI in throwaway repos (see README-setup.md). Worst verdict: **fail** (one docs criterion).

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 harness config without team keys keeps the recorded norn_version | pass | 01-harness.md | |
| 01.AC2 harness config with team keys writes them after norn_version | pass | 01-harness.md | |
| 02.AC1 baseline rule on 0.29.4: version_too_old, its text, the 0.30.x path | pass | 02-guard.md | |
| 02.AC2 baseline rule on no version: version_missing, names norn init | pass | 02-guard.md | |
| 02.AC3 acting commands on 0.29.4 exit 3 and change nothing | pass | 02-guard.md | |
| 02.AC4 acting commands on no version exit 3; config error still exit 6 | pass | 02-guard.md, 02-guard-2.md | |
| 02.AC5 help/doctor/init/upgrade not stopped by the guard; watch pauses | pass | 02-guard-2.md, 02-watch-mid.md | watch refuses at start, pauses ticks mid-run |
| 02.AC6 status shows an Unblock item pointing to norn doctor | pass | 02-guard.md | |
| 02.AC7 release note names the refusal and both codes | pass | release-notes.md | |
| 03.AC1 upgrade rewrites/relinks skills, bumps version, stages, prints commit | pass | 03-upgrade.md, 03-upgrade-2.md | |
| 03.AC2 interrupted upgrade finishes on rerun | pass | 03-upgrade.md | |
| 03.AC3 missing labels created; unreachable remote reported, upgrade succeeds | pass | 03-upgrade-3.md | stub gh |
| 03.AC4 already current: nothing to upgrade; skills only: Refresh commit | pass | 03-upgrade.md | |
| 03.AC5 version_backward, not_main_checkout, tick_locked refusals | pass | 03-upgrade-2.md | |
| 03.AC6 upgrade on 0.29.4 refused with the 0.30 path | pass | 02-guard-2.md | |
| 03.AC7 upgrade on no version refused, names norn init | pass | 02-guard-2.md | |
| 03.AC8 upgrade --json has exactly five fields | pass | 03-upgrade.md | |
| 03.AC9 old key, needs, .gitattributes untouched; old key hint names no upgrade | pass | 03-upgrade-2.md, 03-upgrade-3.md | |
| 03.AC10 norn migrate is an unknown command, not in help | pass | 03-upgrade-2.md | |
| 03.AC11 docs describe upgrade from 0.30 on, nothing on removed migrations | **fail** | 03-AC11-docs.md | F1: reference.md:24, concepts.md:101 |
| 03.AC12 release note names migrate removal and dropped --json fields | pass | release-notes.md | |
| 04.AC1 doctor's version check fails with the guard's words | pass | 04-doctor-init.md, 04-doctor-0.29.4.json | |
| 04.AC2 init on no team file records the running version | pass | 04-AC2.md | |
| 04.AC3 init on a no/pre-0.30 team file refused, nothing written | pass | 02-guard-2.md | note: do_instead on no version still says "run `norn init`" |
| 04.AC4 init on 0.30+ keeps version and differing skill, names upgrade | pass | 04-AC4.md | |
| 05.AC1 pre-0.13 repo refused version_missing, old files untouched | pass | 05-layout.md | |
| 05.AC2 hooks do not refuse on the layout | pass | 05-layout.md | |
| 05.AC3 doctor has no layout section, no migrate mention | pass | 05-layout.md | |
| 06.AC1 runs/ in a story branch tree never changed; story moves on | pass | 06-AC1-setup.md, 06-AC1.md | |
| 06.AC2 runs/ in the base tree: status says nothing | pass | 06-base-runs.md | |
| 06.AC3 doctor has no run-state section | pass | 06-base-runs.md | |
| 06.AC4 golden: only record-move cases gone; snapshots/transcripts unchanged | person | 06-AC4-golden.md | one transcript lost the branch-tree runs/ read |
