| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 | pass | evidence/01.md, evidence/mutations/ |  |
| 01.AC2 | pass | evidence/01.md |  |
| 01.AC3 | pass | evidence/01.md |  |
| 01.AC4 | pass | evidence/01.md |  |
| 01.AC5 | pass | evidence/01.md |  |
| 01.AC6 | pass | evidence/01.md, evidence/mutations/ |  |
| 01.AC7 | pass | evidence/01.md |  |
| 02.AC1 | pass | evidence/02.md |  |
| 02.AC2 | pass | evidence/02.md |  |
| 02.AC3 | pass | evidence/02.md |  |
| 02.AC5 | pass | evidence/02.md |  |
| 02.AC6 | pass | evidence/02.md |  |
| 02.AC4 | person | evidence/02.md |  |
| 03.AC1 | pass | evidence/03.md |  |
| 03.AC2 | pass | evidence/03.md |  |
| 03.AC3 | pass | evidence/03.md |  |
| 03.AC4 | pass | evidence/03.md |  |
| 03.AC5 | pass | evidence/03.md |  |
| 03.AC6 | pass | evidence/03.md | the triage-table lint only matches rows that start with a workflow name; a table led by the label column passes it |
| 04.AC1 | pass | evidence/04.md |  |
| 04.AC2 | pass | evidence/04.md |  |
| 04.AC3 | pass | evidence/04.md |  |
| 04.AC4 | pass | evidence/04.md |  |
| 04.AC5 | pass | evidence/04.md, evidence/04-AC5.png, evidence/04/ | rendered locally with mermaid-cli 11.4.2 (all 7 blocks, exit 0); GitHub's own renderer not seen, the branch head is not pushed |
| 05.AC1 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC2 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC3 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC4 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC5 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC6 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC7 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC8 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC9 | pass | evidence/05.md, evidence/05/ |  |
| 06.AC1 | pass | evidence/06.md, evidence/tick-06.log |  |
| 06.AC2 | pass | evidence/06.md, evidence/mutations/ |  |
| 07.AC1 | pass | evidence/07.md, evidence/07/ |  |
| 07.AC2 | pass | evidence/07.md, evidence/07/ |  |
| 07.AC3 | pass | evidence/07.md, evidence/07/ |  |
| 07.AC4 | pass | evidence/07.md, evidence/07/ |  |
| 07.AC5 | pass | evidence/07.md, evidence/07/ |  |
| 08.AC1 | pass | evidence/08.md, evidence/08/lab-build.json | observed live; but the integration test for it fails on every run (reads greet.sh after the play merged): finding F2 |
| 08.AC2 | pass | evidence/08.md, evidence/08/status-beat1.json |  |
| 08.AC3 | pass | evidence/08.md, evidence/08/status-beat3.json, evidence/08/trace-rules-beats1-3.txt |  |
| 08.AC4 | unverified | evidence/08.md, evidence/08/ci-lab-integration-de71f47.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 08.AC5 | unverified | evidence/08.md, evidence/08/ci-lab-integration-de71f47.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 08.AC6 | unverified | evidence/08.md, evidence/08/ci-lab-integration-de71f47.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 08.AC7 | unverified | evidence/08.md, evidence/08/ci-lab-integration-de71f47.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 08.AC8 | unverified | evidence/08.md, evidence/08/ci-lab-integration-de71f47.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 08.AC10 | unverified | evidence/08.md, evidence/08/ci-lab-integration-de71f47.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 08.AC9 | fail | evidence/08.md, evidence/08/ci-lab-integration-de71f47.log | bun test --config=bunfig.integration.toml --timeout=60000 packages/cli -t "norn lab plays" (CI, PR #518 run 45210497865 shard 2/4). Expected after beat 8's merge: unit ended done and story.claim null. |
| 08.AC11 | pass | evidence/08.md, evidence/08/ |  |
| 08.AC12 | pass | evidence/08.md, evidence/08/ |  |
| 08.AC13 | pass | evidence/08.md, evidence/08/ |  |
| 08.AC14 | pass | evidence/08.md |  |
| 09.AC1 | unverified | evidence/09.md, evidence/08/tty-dev-devnull.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 09.AC2 | unverified | evidence/09.md, evidence/08/tty-dev-devnull.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 09.AC3 | unverified | evidence/09.md, evidence/08/tty-dev-devnull.log | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 09.AC4 | unverified | evidence/09.md | beat captions are past tense but print as the beat's first step is reached: beat 2's 'the check failed' prints while implement attempt 1 still runs |
| 10.AC1 | pass | evidence/10.md, evidence/10/ |  |
| 10.AC2 | pass | evidence/10.md, evidence/10/ |  |
| 10.AC3 | pass | evidence/10.md, evidence/10/ |  |
| 10.AC4 | pass | evidence/10.md, evidence/10/ |  |
| 10.AC5 | pass | evidence/10.md, evidence/10/ |  |
| 10.AC6 | unverified | evidence/10.md, evidence/10/ | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 10.AC7 | unverified | evidence/10.md, evidence/10/ | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 10.AC8 | unverified | evidence/10.md, evidence/10/ | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 10.AC9 | pass | evidence/10.md, evidence/10/ |  |
| 10.AC10 | pass | evidence/10.md, evidence/10/ | F1-F3 rework seen live: foreign Host 403, foreign Origin/Sec-Fetch-Site 403, text/plain 415, buttons during the first build 409 lab_not_ready (evidence/10/security.txt, race-lab-not-ready.txt). Host c |
| 10.AC11 | person | evidence/10.md, evidence/10/ |  |
| 10.AC12 | person | evidence/10.md, evidence/10/ |  |
| 11.AC1 | pass | evidence/11.md, evidence/11/ |  |
| 11.AC2 | unverified | evidence/11.md, evidence/11/ | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 11.AC3 | unverified | evidence/11.md, evidence/11/ | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 11.AC5 | unverified | evidence/11.md, evidence/11/ | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stops at beat 3's question; guard not bypass |
| 11.AC4 | pass | evidence/11.md, evidence/11/ |  |
| 11.AC6 | pass | evidence/11.md, evidence/11/ |  |
| 11.AC7 | pass | evidence/11.md, evidence/11/ |  |
