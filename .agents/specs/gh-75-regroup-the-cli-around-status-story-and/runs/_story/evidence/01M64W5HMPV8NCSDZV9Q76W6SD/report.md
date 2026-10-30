# gh-75 QA #2 (HEAD ac1d3321)

Full suite 1418 pass / 0 fail, typecheck clean (suite.txt). The harness drivers from qa#1 (qa.ts, qa3.ts) were rerun on HEAD: every output matches qa#1's apart from ids/shas, except B42, which now refuses branch_missing and names the branch. The hand-run checks (help, removed commands, status, create, config, TTY prompts, agent protocol) were rerun in a fresh throwaway repo with matching output.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| B1 | pass | B1.md |  |
| B2 | pass | B2.md |  |
| B3 | pass | B3.md |  |
| B4 | pass | B4.md |  |
| B5 | pass | B5.md |  |
| B6 | pass | B6.md |  |
| B7 | pass | B7.md, B9.md, B51.md, B15.md, B16.md; grep of all evidence: no printed command names a removed verb |  |
| B8 | pass | suite.txt |  |
| B9 | pass | B9.md |  |
| B10 | pass | B10.md |  |
| B11 | pass | B11.typescript |  |
| B12 | unverified | — | needs herdr per the brief |
| B13 | pass | B13.md, B13-stderr.txt |  |
| B14 | pass | B14.md |  |
| B15 | pass | B15.md, B70.md |  |
| B16 | pass | B16.md, B55-2.md |  |
| B17 | unverified | — | needs browser |
| B18 | unverified | — | needs remote |
| B19 | person | — |  |
| B20 | pass | B20.md |  |
| B21 | pass | B21.md |  |
| B22 | pass | B22.md |  |
| B23 | unverified | — | needs browser and remote |
| B24 | pass | B24.md |  |
| B25 | pass | B58.md, B25.md |  |
| B26 | pass | B26.md, B56.md |  |
| B27 | pass | B27-2.md |  |
| B28 | pass | B28-2.md |  |
| B29 | unverified | — | needs herdr |
| B30 | pass | B30.md |  |
| B31 | pass | B31.md |  |
| B32 | pass | B32.md |  |
| B33 | pass | B33.md, B33-2.md |  |
| B34 | pass | B55-2.md, B34-2.md |  |
| B35 | pass | B35.md |  |
| B36 | pass | B36.md |  |
| B37 | pass | B37.md |  |
| B38 | pass | B38.md |  |
| B39 | pass | B39.md |  |
| B40 | pass | B40.md, B40b.md |  |
| B41 | pass | B41.md |  |
| B42 | pass | B42.md |  |
| B43 | pass | B43.md |  |
| B44 | pass | B44.md |  |
| B45 | pass | B45.md |  |
| B46 | unverified | — | needs herdr |
| B47 | unverified | — | needs herdr |
| B48 | pass | B48.md |  |
| B49 | pass | B49.md |  |
| B50 | pass | B50.md |  |
| B51 | pass | B51.md |  |
| B52 | pass | B52.md, B48.md |  |
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
| B64 | pass | B64.typescript |  |
| B65 | pass | B65.md |  |
| B66 | pass | B66.md |  |
| B67 | pass | B67.md |  |
| B68 | pass | B68.md |  |
| B69 | pass | B69.md |  |
| B70 | pass | B70.md |  |
| B71 | pass | suite.txt |  |
