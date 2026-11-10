# gh-318 QA #3 at 040bcca51
| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 decide puts worktree paths under the reported folder | pass | 01.AC1.md | |
| 01.AC2 golden replay with the old folder: no change | pass | 01.AC2.md | |
| 01.AC3 one store function names the folder | pass | 01.AC3.md | |
| 02.AC1 harness names a worktree by folder name | pass | 02.AC1.md | integration/e2e tiers: CI |
| 02.AC2 no hand-spelled -worktrees in tests | pass | 02.AC2.md | |
| 03.AC1 story worktree in the machine dir | pass | 03.AC1.md | |
| 03.AC2 slice worktree beside it | pass | 03.AC2.md | |
| 03.AC3 no <repo>-worktrees after cleanup | pass | 03.AC3.md | |
| 03.AC4 follows the bound home (incl. symlinked) | pass | 03.AC4.md | |
| 03.AC5 two clones separate | pass | 03.AC5.md | |
| 03.AC6 --print, inbox, brief, Herdr tab | pass | 03.AC6.md | |
| 03.AC7 tidy orphans | pass | 03.AC7.md | |
| 03.AC8 gone-check recreates | pass | 03.AC8.md | |
| 03.AC9 status --json reach | pass | 03.AC9.md | |
| 03.AC10 rewritten golden: no change | pass | 03.AC10.md | |
| 03.AC11 docs | pass | 03.AC11.md | |
Scripts: observe.ts, observe2.ts, observe3.ts (harness-driven CLI in temp repos, removed on cleanup), cmp.py (golden comparison).
observe.ts exits 1 at its last block, 'tick --home', which is no CLI flag (exit 2); its AC5 block found clone A without a free slot. Both are superseded by observe2.ts, which covers them.
