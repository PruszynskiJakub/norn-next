| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 decide puts story/slice worktrees under the reported Facts.repo.worktrees folder | pass | 01.AC1.md | |
| 01.AC2 golden replay with the old folder as the fact decides exactly as before | pass | 01.AC2.md | checked at slice 01's commit f373cf056 |
| 01.AC3 only store's worktreesDir builds the folder; observe and view fill the fact from it | pass | 01.AC3.md | |
| 02.AC1 harness h.worktree gives the creation path; tests pass with transcripts unchanged | pass | 02.AC1.md | e2e 74/74 at HEAD; integration tier is CI-only, no CI run yet |
| 02.AC2 no hand-spelled -worktrees in tests/support outside the helper | pass | 02.AC2.md | |
| 03.AC1 story worktree at <machine dir>/worktrees/<story>-<slug> | pass | 03.AC1.md, observe2-output.md | |
| 03.AC2 slice worktree at …/worktrees/<story>-<slug>--<nn>-<slug> | pass | 03.AC2.md, observe-output.md | |
| 03.AC3 harness cleanup finds no <repo>-worktrees | pass | 03.AC3.md | |
| 03.AC4 bound home (--home / NORN_HOME_DIR) holds the worktree | pass | 03.AC4.md, observe2-output.md | |
| 03.AC5 two clones land in their own machine dirs | pass | 03.AC5.md, observe2-output.md | |
| 03.AC6 --print, inbox, brief, Herdr tab cwd show the machine-dir path | pass | 03.AC6.md, observe2-output.md | |
| 03.AC7 tidy reports both orphans, removes only the clean one | pass | 03.AC7.md, observe-output.md | |
| 03.AC8 story start notices a deleted worktree and recreates it | pass | 03.AC8.md, observe2-output.md | |
| 03.AC9 status --json shows each unit's machine-dir worktree | pass | 03.AC9.md, observe-output.md | |
| 03.AC10 rewritten golden corpus: no decision changes | pass | 03.AC10.md | |
| 03.AC11 docs say worktrees live in the machine dir; no <repo>-worktrees | pass | 03.AC11.md | |
