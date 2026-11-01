# QA report: gh-71 rounds

How it was run: user scenarios driven through `norn` commands and `norn tick` (in-process `runCli`, the same entry as the binary), with real git repos, a bare remote and worktrees, against the harness's fake GitHub remote, fake runner and fake clock. Scripts in `scripts/` (a/b/c/d/e.test.ts, run with `bun test --config=scripts/bunfig.toml`). Workflows are small stand-ins for triage/story/quick (the repo's own triage.yaml does not validate in a throwaway repo without its repo-local skill). Command output is saved per criterion.

Test tiers on the branch: unit 1022 pass, integration 554 pass, e2e 72 pass, typecheck clean (unit.log, int.log, e2e.log, tc.log).

D11 prompt text: triage.yaml and reproduce.yaml gate prompts say approving ends the round and the next round starts with `norn story edit gh-N --workflow <name>`.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B6.md, B30.md, B29.md (gh-61 |  |
| B2 | pass | B2.md |  |
| B3 | pass | B3.md + B6.md |  |
| B4 | pass | B4.md |  |
| B5 | pass | B5.md + B6.md |  |
| B6 | pass | B6.md |  |
| B7 | pass | B7.md, B4.md |  |
| B8 | pass | B8.md |  |
| B9 | pass | B9.md (unknown step refused exit 3, code unknown_step, names quick's steps, record unchanged B17.md); B11.md/B33.md (--at sync, --at slices start round there) |  |
| B10 | pass | B10.md |  |
| B11 | pass | B11.md |  |
| B12 | pass | B12.md |  |
| B13 | pass | B13.md |  |
| B14 | pass | B14.md + B6.md |  |
| B15 | pass | B15.md |  |
| B16 | pass | B16.md |  |
| B17 | pass | B17.md |  |
| B18 | pass | B18.md |  |
| B19 | pass | B19.md |  |
| B20 | pass | B20.md |  |
| B21 | pass | B21-C.md |  |
| B22 | pass | B22-C.md |  |
| B23 | pass | B23-C.md |  |
| B24 | pass | B24-C.md |  |
| B25 | pass | B25.md |  |
| B26 | pass | B23-C.md / B22-C.md |  |
| B27 | fail | B27-C.md, B27.md, B7.md | repro in findings.json |
| B28 | fail | B28.md, B6.md | repro in findings.json |
| B29 | pass | B29.md |  |
| B30 | pass | B30.md |  |
| B31 | pass | B31.md |  |
| B32 | pass | B32.md |  |
| B33 | pass | B33.md |  |
| B34 | pass | B34.md |  |
| B35 | pass | B35.md |  |
| B36 | pass | B36.md |  |

Notes (no verdict change):
- B22: in scenario B a sync tick that only re-acquired an expired claim (10 min clock jump) did not close gh-34; the later non-sync ticks showed a Check item 'remote: issue closed — the round stays finished' instead. It closes on a sync that sees the issue (scenario C). The Check text reads as if norn will never close it.
- B15: `run list` labels an `--at` move inside a round 'workflow switched to story at plan', though the workflow did not change.
- B18: the refusal exits 5 (claim_held), as `story edit` does today; the do_instead is 'norn story checkout gh-50 --force'.
