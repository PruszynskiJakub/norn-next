# gh-75 qa#1

Suite: 1417 pass, 0 fail (suite.txt). Real CLI = `bun packages/cli/src/main.ts` in a throwaway repo (B1–B5, B11, B13, B14, B20–B22, B61–B68, B70); stateful verbs via runCli over the test harness (fake remote/runner, real git): qa.ts, qa3.ts, qa4.ts here.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B1.md |  |
| B2 | pass | B2.md |  |
| B3 | pass | B3.md |  |
| B4 | pass | B4.md |  |
| B5 | pass | B5.md |  |
| B6 | pass | B6.md (real CLI empty repo + harness with stories) |  |
| B7 | pass | B7.md, B9.md, B51.md, B15.md, B16.md; grep of all evidence: no printed command names a removed verb |  |
| B8 | pass | suite.txt (test/repo.test.ts 'removed commands (B5, B8, B71)' passed); plugins/herdr/open.sh runs `status --watch --pane`, next.sh `run attach --next` |  |
| B9 | pass | B9.md |  |
| B10 | pass | B10.md |  |
| B11 | pass | B11.typescript (real TTY: full-screen cockpit, q quits, --interval 5s accepted) |  |
| B12 | unverified |  | seen by accident: pane opened below, ran `norn` from PATH, not the launching build |
| B13 | pass | B13.md, B13-stderr.txt |  |
| B14 | pass | B14.md (same line as released 0.11.1 in the same repo) |  |
| B15 | pass | B15.md, B70.md |  |
| B16 | pass | B16.md, B55-2.md |  |
| B17 | unverified |  | needs browser |
| B18 | unverified |  | needs remote |
| B19 | person |  |  |
| B20 | pass | B20.md |  |
| B21 | pass | B21.md (real CLI), B21-harness.md (no remote call) |  |
| B22 | pass | B22.md (real gh failure, no worktree/story), B22-harness.md (refs unchanged) |  |
| B23 | unverified |  | needs browser and remote |
| B24 | pass | B24.md |  |
| B25 | pass | B58.md, B25.md |  |
| B26 | pass | B26.md, B56.md |  |
| B27 | pass | B27-2.md (gate → update → test), B27.md (refusals) |  |
| B28 | pass | B28-2.md | headless/fake runner: --print and command path observed; the Herdr tab open needs herdr |
| B29 | unverified |  | needs herdr |
| B30 | pass | B30.md |  |
| B31 | pass | B31.md |  |
| B32 | pass | B32.md |  |
| B33 | pass | B33.md, B33-2.md |  |
| B34 | pass | B55-2.md, B34-2.md |  |
| B35 | pass | B35.md |  |
| B36 | pass | B36.md | prompt says 'Worktrees for 1 units' (plural nit) |
| B37 | pass | B37.md |  |
| B38 | pass | B38.md |  |
| B39 | pass | B39.md |  |
| B40 | pass | B40.md, B40b.md |  |
| B41 | pass | B41.md |  |
| B42 | fail | B42.md | story branch missing → not named; finding F1 |
| B43 | pass | B43.md |  |
| B44 | pass | B44.md |  |
| B45 | pass | B45.md (--why), B45-2.md (--receipt) |  |
| B46 | unverified |  | needs herdr |
| B47 | unverified |  | needs herdr |
| B48 | pass | B48.md |  |
| B49 | pass | B49.md |  |
| B50 | pass | B50.md |  |
| B51 | pass | B51.md |  |
| B52 | pass | B52.md, B48.md | Herdr pane survival not observable here; ruling at fb70c6b accepts that cancel closes the pane under Herdr |
| B53 | pass | B53.md |  |
| B54 | pass | B54.md |  |
| B55 | pass | B55-2.md |  |
| B56 | pass | B56.md |  |
| B57 | pass | B57.md |  |
| B58 | pass | B58.md |  |
| B59 | pass | B59.md |  |
| B60 | pass | B60.md |  |
| B61 | pass | B61.md |  |
| B62 | pass | B62.md |  |
| B63 | pass | B63.md, B67.md |  |
| B64 | pass | B64.typescript (real TTY prompt, picked repo) |  |
| B65 | pass | B65.md |  |
| B66 | pass | B66.md |  |
| B67 | pass | B67.md |  |
| B68 | pass | B68.md |  |
| B69 | pass | B69.md (brief, brief --json, done refusal + done, ask → story answer, hook stop in a unit worktree; same flags and replies as before) |  |
| B70 | pass | B70.md |  |
| B71 | pass | suite.txt (test/repo.test.ts lint over the PRD passed); .agents/PRD.md S7 and W9 name `norn story edit … --workflow … --at` |  |
