# QA report: gh-517 qa #1

See evidence/README.md for the environment, the person-only limitation and a disclosure.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 | pass | evidence/01.md, evidence/mutations/mut-01-AC1.log |  |
| 01.AC2 | pass | evidence/01.md |  |
| 01.AC3 | pass | evidence/01.md |  |
| 01.AC4 | pass | evidence/01.md |  |
| 01.AC5 | pass | evidence/01.md |  |
| 01.AC6 | pass | evidence/01.md, evidence/mutations/mut-01-AC6.log |  |
| 01.AC7 | pass | evidence/01.md |  |
| 02.AC1 | pass | evidence/02.md, evidence/02-when-hash.txt |  |
| 02.AC2 | pass | evidence/02.md, evidence/02-when-hash.txt, evidence/02-emit-and-golden.log |  |
| 02.AC3 | pass | evidence/02.md, evidence/05/pack-quick.mmd |  |
| 02.AC4 | pass | evidence/02.md, evidence/mutations/mut-02-AC4.log |  |
| 02.AC5 | pass | evidence/02.md, evidence/mutations/mut-02-AC5.log |  |
| 02.AC6 | pass | evidence/02.md, evidence/02-emit-and-golden.log |  |
| 03.AC1 | pass | evidence/03.md |  |
| 03.AC2 | pass | evidence/03.md |  |
| 03.AC3 | pass | evidence/03.md |  |
| 03.AC4 | pass | evidence/03.md, evidence/mutations/mut-03-AC4.log |  |
| 03.AC5 | pass | evidence/03.md, evidence/mutations/mut-03-AC5.log |  |
| 03.AC6 | pass | evidence/03.md, evidence/mutations/mut-03-AC6.log |  |
| 04.AC1 | pass | evidence/04.md |  |
| 04.AC2 | pass | evidence/04.md, evidence/05/doc-quick.mmd |  |
| 04.AC3 | pass | evidence/04.md, evidence/05/doc-quick.mmd |  |
| 04.AC4 | pass | evidence/04.md, evidence/mutations/mut-04-AC4.log |  |
| 04.AC5 | pass | evidence/04.md, evidence/04-AC5-mermaid.png | rendered with Mermaid 11.4.1 (GitHub's renderer family) in headless Chrome, not on github.com itself; a person may glance at docs/workflows.md on GitHub once the PR is up |
| 05.AC1 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC2 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC3 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC4 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC5 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC6 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC7 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC8 | pass | evidence/05.md, evidence/05/ |  |
| 05.AC9 | pass | evidence/05.md, evidence/05/ |  |
| 06.AC1 | pass | evidence/06.md, evidence/06-tick.md, evidence/06-tick.json |  |
| 06.AC2 | pass | evidence/06.md, evidence/mutations/mut-06-AC2a.log, evidence/mutations/mut-06-AC2b.log |  |
| 07.AC1 | pass | evidence/07.md, evidence/07-tests.log |  |
| 07.AC2 | pass | evidence/07.md |  |
| 07.AC3 | pass | evidence/07.md |  |
| 07.AC4 | pass | evidence/07.md, evidence/07-tests.log |  |
| 07.AC5 | pass | evidence/07.md |  |
| 08.AC1 | pass | evidence/08.md, evidence/09-tty-run.log, evidence/10/state-beat3.json |  |
| 08.AC2 | pass | evidence/08.md, evidence/08/git-beat3.txt, evidence/08/status-beat3.json |  |
| 08.AC3 | pass | evidence/08.md, evidence/08/status-beat3.json |  |
| 08.AC4 | unverified | evidence/08.md | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 08.AC5 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 08.AC6 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 08.AC7 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 08.AC8 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 08.AC9 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 08.AC10 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 08.AC11 | pass | evidence/08.md, evidence/08/iso-before.txt, evidence/08/iso-after.txt | two labs ran side by side to beat 3, the furthest a play goes below an agent session; the person commands of later beats run in the lab's own cwd and NORN_HOME_DIR |
| 08.AC12 | pass | evidence/08.md, evidence/08/resume.log, evidence/08/clean.log |  |
| 08.AC13 | pass | evidence/08.md |  |
| 08.AC14 | pass | evidence/08.md |  |
| 09.AC1 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 09.AC2 | unverified | evidence/09-tty-run.log | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 09.AC3 | unverified |  | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 09.AC4 | unverified | evidence/09-tty-run.log | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 10.AC1 | pass | evidence/10.md, evidence/10/serve.log |  |
| 10.AC2 | pass | evidence/10.md |  |
| 10.AC3 | pass | evidence/10.md, evidence/10/state-beat3.json, evidence/11/state-running.json |  |
| 10.AC4 | pass | evidence/10.md, evidence/10/state-beat3.json |  |
| 10.AC5 | pass | evidence/10.md, evidence/10/state-beat3.json |  |
| 10.AC6 | pass | evidence/10.md, evidence/10/state-beat3.json |  |
| 10.AC7 | pass | evidence/10.md, evidence/10-AC7-state-docs.json |  |
| 10.AC8 | unverified | evidence/10.md, evidence/10/act-answer.json, evidence/10-AC8-buttons.jsonl | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 10.AC9 | pass | evidence/10.md, evidence/10/act-reset.json |  |
| 10.AC10 | pass | evidence/10.md, evidence/10/, evidence/11/ |  |
| 10.AC11 | person | evidence/10-AC11-dashboard.png | open evidence/10-AC11-dashboard.png (headless Chrome, lab at beat 3), or run `norn lab` an… |
| 10.AC12 | person | evidence/10.md | read README.md's '## Try this' (starts with `norn lab`) and play docs/assets/norn-lab.gif … |
| 11.AC1 | pass | evidence/11.md, evidence/11/act-kill.json, evidence/11/state-after-kill.json |  |
| 11.AC2 | unverified | evidence/11.md, evidence/11/act-fail-check.json | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 11.AC3 | unverified | evidence/11.md, evidence/11/act-move-base.json | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 11.AC4 | pass | evidence/11.md, evidence/11/status-corrupt.json |  |
| 11.AC5 | unverified | evidence/11.md, evidence/11/status-expired.json, evidence/11/tick-expired.json, evidence/11/take-refused.json | norn story answer/approve/reject/round and norn run rerun are person-only and are refused … |
| 11.AC6 | pass | evidence/11.md, evidence/11/act-kill.json, evidence/11/act-fail-check.json, evidence/11/act-move-base.json, evidence/11/act-corrupt.json, evidence/11/act-expire-claim.json |  |
| 11.AC7 | pass | evidence/11.md, evidence/11/ |  |
