# QA report: gh-71 rounds (qa #2, HEAD 1a2816c57)

How it was run: qa#1's user scenarios (scripts/a–e.test.ts) rerun on the current HEAD. They drive `norn` commands and `norn tick` through the harness (in-process runCli, real git repos, a bare remote and worktrees, a fake GitHub remote, a fake runner and a fake clock). Run them with `EV=<dir> bun test --config=scripts/bunfig.toml`. Every evidence file was regenerated in this run.

Tiers: unit 1022 pass, integration 557 pass (int.log), e2e 72 pass (e2e.log), typecheck clean.

qa#1 failures re-checked:
- B27: a finished round whose open-pr opened PR #100 now shows 'Merge PR #100 (still a draft)' before any sync (gh-33 at 0s, gh-42 before tick --sync).
- B28: plain `norn status` prefixes each item with 'round N · <workflow> · '.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B6.md, B30.md, B29.md (gh-61 rounds 1-3 on one branch) | |
| B2 | pass | B2.md | |
| B3 | pass | B3.md, B6.md | |
| B4 | pass | B4.md | |
| B5 | pass | B5.md, B6.md (manual carried into round 2) | |
| B6 | pass | B6.md | |
| B7 | pass | B7.md, B4.md | |
| B8 | pass | B8.md | |
| B9 | pass | B9.md, B11.md, B33.md | |
| B10 | pass | B10.md | |
| B11 | pass | B11.md | |
| B12 | pass | B12.md | |
| B13 | pass | B13.md | |
| B14 | pass | B14.md, B6.md | |
| B15 | pass | B15.md | |
| B16 | pass | B16.md | |
| B17 | pass | B17.md | |
| B18 | pass | B18.md | |
| B19 | pass | B19.md | |
| B20 | pass | B20.md | |
| B21 | pass | B21-C.md | |
| B22 | pass | B22-C.md | |
| B23 | pass | B23-C.md, B23.md | |
| B24 | pass | B24-C.md | |
| B25 | pass | B25.md | |
| B26 | pass | B26.md, B25.md (command is --workflow <name>) | |
| B27 | pass | B27-C.md (gh-42: 'Merge PR #100' before and after tick --sync), B27.md (gh-33: 'Merge PR #100' at 0s, before any sync) | |
| B28 | pass | B28.md (status: 'round 1 · triage · …', story view: 'round 2 · story · ready at refine', handoff 'Round 2 · Workflow: story · Step: refine (attempt 1)'), B6.md | |
| B29 | pass | B29.md | |
| B30 | pass | B30.md | |
| B31 | pass | B31.md | |
| B32 | pass | B32.md, B11.md | |
| B33 | pass | B33.md | |
| B34 | pass | B34.md | |
| B35 | pass | B35.md | |
| B36 | pass | B36.md | |

Notes (no verdict change):
- B22: in scenario B, a sync tick that only re-acquired an expired claim did not close gh-34; the inbox showed a Check item 'remote: issue closed — the round stays finished'. Scenario C closes on the sync that sees the issue (B22-C.md).
- B15: `run list` labels an `--at` move inside a round 'workflow switched to story at plan'.
- B28: the round_done line repeats the id and the step: 'gh-61  round 1 · triage · $done: gh-61: triage round done, no PR'.
- B33: QA saw slices recording round 2 next to _story. A third round adding new slice numbers was not exercised; slice numbers come from the slice files.
