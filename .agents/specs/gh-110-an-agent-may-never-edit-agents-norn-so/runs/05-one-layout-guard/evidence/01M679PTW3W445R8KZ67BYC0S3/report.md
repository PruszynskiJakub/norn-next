# QA gh-110/05 — one layout guard
Full suite: 1457 pass, 4 fail — all in check-run.test.ts (5 s beforeAll timeouts while another worktree's `bun test` ran at the same time); that file alone: 5/5 pass (check-run-alone.log). Typecheck green. layout-guard.test.ts 13/13.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| AC1 (B18) | pass | AC1.md, AC1-AC3-AC5-old.txt, AC1-per-part.txt | each part alone too |
| AC2 (B17) | pass | AC2.md, AC2-AC4-both.txt | all three parts |
| AC3 (B19) | pass | AC3.md | |
| AC4 (B20) | pass | AC4.md | plain doctor skips machine group |
| AC5 (B18) | pass | AC5.md | |
| AC6 (B21) | pass | AC6.md, AC6-cli.txt | real unit via test only |
| AC7 (B17, B18) | pass | AC7.md | status --segment blank on old layout |
