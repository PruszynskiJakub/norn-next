# QA #3 report: gh-517 at edd288edd

Live checks ran against the dev build at HEAD (labs under /private/tmp/claude-501, own TMPDIR and NORN_HOME_DIR). Person-only commands are refused below this agent session, so plays stop at beat 3.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 01.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 01.AC2 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 01.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 01.AC3 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 01.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 01.AC4 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 01.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 01.AC5 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 01.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 01.AC6 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 01.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 01.AC7 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 01.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 02.AC1 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 02.md, 02-when-hash.txt, 02-emit-and-golden.log) and QA #2's pass at eb7891450; since then | |
| 02.AC2 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 02.md, 02-when-hash.txt, 02-emit-and-golden.log) and QA #2's pass at eb7891450; since then | |
| 02.AC3 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 02.md, 02-when-hash.txt, 02-emit-and-golden.log) and QA #2's pass at eb7891450; since then | |
| 02.AC4 | person | The 7 pack workflows carry when: (static/carry-over.txt). This repo's .agents/workflows/release.yaml and triage.yaml keep the text as a header comment, not when | |
| 02.AC5 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 02.md, 02-when-hash.txt, 02-emit-and-golden.log) and QA #2's pass at eb7891450; since then | |
| 02.AC6 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 02.md, 02-when-hash.txt, 02-emit-and-golden.log) and QA #2's pass at eb7891450; since then | |
| 03.AC1 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 03.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 03.AC2 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 03.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 03.AC3 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 03.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 03.AC4 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 03.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 03.AC5 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 03.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 03.AC6 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 03.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 04.AC1 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 04.md, 04-AC5-mermaid.webp) and QA #2's pass at eb7891450; since then only packages/cli/sr | |
| 04.AC2 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 04.md, 04-AC5-mermaid.webp) and QA #2's pass at eb7891450; since then only packages/cli/sr | |
| 04.AC3 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 04.md, 04-AC5-mermaid.webp) and QA #2's pass at eb7891450; since then only packages/cli/sr | |
| 04.AC4 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 04.md, 04-AC5-mermaid.webp) and QA #2's pass at eb7891450; since then only packages/cli/sr | |
| 04.AC5 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 04.md, 04-AC5-mermaid.webp) and QA #2's pass at eb7891450; since then only packages/cli/sr | |
| 05.AC1 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC2 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC3 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC4 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC5 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC6 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC7 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC8 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 05.AC9 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 05.md) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{lab.ts,tty.ts} | |
| 06.AC1 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 06.md, 06-tick.json) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{ | |
| 06.AC2 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 06.md, 06-tick.json) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{ | |
| 07.AC1 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 07.md, 07-tests.log) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{ | |
| 07.AC2 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 07.md, 07-tests.log) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{ | |
| 07.AC3 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 07.md, 07-tests.log) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{ | |
| 07.AC4 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 07.md, 07-tests.log) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{ | |
| 07.AC5 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 07.md, 07-tests.log) and QA #2's pass at eb7891450; since then only packages/cli/src/lab/{ | |
| 08.AC1 | pass | Observed live at HEAD: $TMPDIR/norn-lab holds repo (greet.sh prints "hello", test.sh), remote.git, home, README; config local tracker, forge none, local store,  | |
| 08.AC2 | pass | Live: branch norn/lt-1, its worktree under the lab home, claim held in status --json (evidence/08/build-beat3.txt, 08/status-beat3.json) | |
| 08.AC3 | pass | Live: counters check.fail = 1 of 5 after the failed check looped back to implement (evidence/08/status-beat3.json); --tty beat 2 caption (evidence/09/tty-run.lo | |
| 08.AC4 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 08.AC5 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 08.AC6 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 08.AC7 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 08.AC8 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 08.AC9 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 08.AC10 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 08.AC11 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 08.md, 08/iso-before.txt, 08/iso-after.txt) and QA #2's pass at eb7891450; since then only | |
| 08.AC12 | pass | carry-over of QA #1 evidence (published on refs/norn/evidence/gh-517: 08.md, 08/resume.log, 08/clean.log) and QA #2's pass at eb7891450; since then only package | |
| 08.AC13 | pass | Live config holds the one executors line with its comment naming {harness: claude, runner: headless} (evidence/08/build-beat3.txt); reference documents norn lab | |
| 08.AC14 | pass | Beats 1-3 captions seen live with their Look line (evidence/09/tty-run.log, 10/state-beat3.json); all eight read in QA #1 (08.md on refs/norn/evidence/gh-517);  | |
| 09.AC1 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 09.AC2 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 09.AC3 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 09.AC4 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 10.AC1 | pass | Live at HEAD: `norn lab --port 61733` printed http://127.0.0.1:61733/ and served it (evidence/10/serve.log); no browser opened | |
| 10.AC2 | pass | Live at HEAD: second lab on the taken port refused `port_taken`, exit 3, port named (evidence/10/http-checks.txt) | |
| 10.AC3 | pass | Live at HEAD: state carries the quick graph and implement is the live step (evidence/10/state-beat3.json, 10/10-AC11-dashboard.png) | |
| 10.AC4 | pass | Live at HEAD: every decision carries its caption (10/state-beat3.json) | |
| 10.AC5 | pass | Live at HEAD: receipts listed in written order, run.started before each launch, commit last (10/state-beat3.json, screenshot) | |
| 10.AC6 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 10.AC7 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 10.AC8 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 10.AC9 | pass | Live at HEAD: Reset answered `norn lab --clean`, exit 0, and the lab restarted at beat 1 (evidence/10/act-reset.json) | |
| 10.AC10 | pass | Live at HEAD: foreign Host 403, foreign Origin 403, text/plain 415, unknown button 404 (evidence/10/http-checks.txt); ~/.norn and this worktree unchanged (11/is | |
| 10.AC11 | person | open evidence/10/10-AC11-dashboard.png (headless Chrome 1440px, live lab at beat 3 on HEAD) or run `bun packages/cli/src/main.ts lab` with a fresh TMPDIR and NO | |
| 10.AC12 | person | read README's 'Try this' (starts with norn lab) and play docs/assets/norn-lab.gif; note the GIF shows the --tty tour, not the dashboard that plain `norn lab` no | |
| 11.AC1 | pass | Live: kill pressed while implement's agent ran: `kill -s KILL -- -49768`, exit 0, with its way out; the next tick decided agent.died.retry (evidence/11/act-kill | |
| 11.AC2 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 11.AC3 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 11.AC4 | pass | Live: corrupt switch wrote invalid JSON over the unit's state.json (copy kept); status --json shows the unit corrupt and waiting for a person (evidence/11/switc | |
| 11.AC5 | unverified | person-only commands (story answer/approve/reject/take, run rerun) are refused in this agent session (person_only, by process ancestry), so every live play stop | |
| 11.AC6 | pass | Live: each switch answered with its command and way out: kill (agent.died.retry), fail-check (revert command), move-base (resolve then rerun --step update), cor | |
| 11.AC7 | pass | Live: switches changed only the lab's repo, remote.git and home (commands target $TMPDIR/norn-lab paths only); ~/.norn listing unchanged, this worktree clean (e | |
