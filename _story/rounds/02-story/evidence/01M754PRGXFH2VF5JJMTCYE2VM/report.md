# QA gh-337, head 8cc853ef

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 | pass | 01.AC1.md |  |
| 01.AC2 | pass | 01.AC2.md |  |
| 01.AC3 | pass | 01.AC3.md |  |
| 02.AC1 | pass | 02.AC1.md |  |
| 02.AC2 | pass | 02.AC2.md |  |
| 02.AC3 | fail | 02.AC3.md, takeover-diverged.test.ts | repro in findings.json |
| 02.AC4 | pass | 02.AC4.md |  |
| 02.AC5 | pass | 02.AC5.md | the doc also claims a takeover merges with the remote branch, which F1 shows is false in the diverged case |
| 03.AC1 | fail | 03.AC1.md, push-rule-run.log | repro in findings.json |
| 03.AC2 | fail | 03.AC2.md, push-rule-run.log | repro in findings.json |
| 03.AC3 | fail | 03.AC3.md, push-rule-run.log | repro in findings.json |
| 03.AC4 | pass | 03.AC4.md |  |
| 03.AC5 | fail | 03.AC5.md, push-rule-run.log | repro in findings.json |
| 03.AC6 | fail | 03.AC6.md, push-rule-run.log | repro in findings.json |
| 03.AC7 | pass | 03.AC7.md |  |
| 04.AC1 | pass | 04.AC1.md |  |
| 04.AC2 | pass | 04.AC2.md |  |
| 04.AC3 | pass | 04.AC3.md |  |
| 04.AC4 | pass | 04.AC4.md |  |
| 04.AC5 | pass | 04.AC5.md |  |
| 04.AC6 | pass | 04.AC6.md |  |
| 04.AC7 | pass | 04.AC7.md |  |
| 04.AC8 | pass | 04.AC8.md |  |
| 04.AC9 | pass | 04.AC9.md |  |
| 05.AC1 | pass | 05.AC1.md | only gates that can reach merge or $done are guarded; agent → human-qa is accepted |
| 05.AC2 | pass | 05.AC2.md |  |
| 05.AC3 | pass | 05.AC3.md |  |
| 06.AC1 | pass | 06.AC1.md |  |
| 06.AC2 | pass | 06.AC2.md |  |
| 06.AC3 | pass | 06.AC3.md |  |
| 07.AC1 | pass | 07.AC1.md |  |
| 07.AC2 | pass | 07.AC2.md | a reject re-reviewed by review approve sets a new anchor, so the light path can still apply (matches 07.AC1) |
| 07.AC3 | pass | 07.AC3.md |  |
| 07.AC4 | pass | 07.AC4.md |  |
| 07.AC5 | pass | 07.AC5.md |  |
| 07.AC6 | pass | 07.AC6.md | no git fake exists; a refused remerge-diff yields resolved, never clean |
| 08.AC1 | pass | 08.AC1.md |  |
| 08.AC2 | pass | 08.AC2.md |  |
| 08.AC3 | pass | 08.AC3.md |  |
| 08.AC4 | pass | 08.AC4.md |  |
| 08.AC5 | pass | 08.AC5.md |  |
| 08.AC6 | pass | 08.AC6.md |  |
| 09.AC1 | pass | 09.AC1.md |  |
| 09.AC2 | pass | 09.AC2.md |  |
| 09.AC3 | pass | 09.AC3.md |  |
| 09.AC4 | pass | 09.AC4.md |  |
| 10.AC1 | pass | 10.AC1.md |  |
| 10.AC2 | pass | 10.AC2.md |  |
| 10.AC3 | pass | 10.AC3.md |  |
| 10.AC4 | pass | 10.AC4.md |  |
| 10.AC5 | pass | 10.AC5.md |  |
| 11.AC1 | pass | 11.AC1.md |  |
| 11.AC2 | pass | 11.AC2.md |  |
| 11.AC3 | pass | 11.AC3.md |  |
| 11.AC4 | pass | 11.AC4.md |  |
| 11.AC5 | pass | 11.AC5.md |  |
| 11.AC6 | pass | 11.AC6.md |  |
| 11.AC7 | pass | 11.AC7.md |  |
| 12.AC1 | pass | 12.AC1.md |  |
| 12.AC2 | pass | 12.AC2.md |  |
| 12.AC3 | pass | 12.AC3.md |  |
| 12.AC4 | pass | 12.AC4.md |  |
| 12.AC5 | pass | 12.AC5.md |  |
| 13.AC1 | pass | 13.AC1.md |  |
| 13.AC2 | pass | 13.AC2.md |  |
| 13.AC3 | pass | 13.AC3.md |  |
| 13.AC4 | pass | 13.AC4.md |  |
| 13.AC5 | pass | 13.AC5.md |  |
| 13.AC6 | pass | 13.AC6.md |  |
| 13.AC7 | pass | 13.AC7.md | no fake GitPort exists; checked against the real adapter |
| 13.AC8 | pass | 13.AC8.md |  |
| 14.AC1 | pass | 14.AC1.md |  |
| 14.AC2 | pass | 14.AC2.md |  |
| 14.AC3 | pass | 14.AC3.md |  |
| 14.AC4 | pass | 14.AC4.md |  |
| 14.AC5 | pass | 14.AC5.md |  |
| 14.AC6 | pass | 14.AC6.md |  |
