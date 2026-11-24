# QA #7 of gh-517 at eb0c5e164

Product code identical to d5f455185 (QA #6); only lab-break-it.test.ts and lab-world.ts changed. Every non-person criterion re-observed on HEAD with the dev build in throwaway TMPDIRs. Result: 59 pass, 15 unverified, 2 person, **1 fail (09.AC4)**. CI evidence at d5f455185: ci/ci-d5f455185-lab-summary.txt.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 | pass | mutations/mutations-a.txt: removing AGENTS.md's Docs rule (or its 'or why none') fails test/repo/process.test.ts 'AGENTS.md's Rules hold the docs rule'; reverte |  |
| 01.AC2 | pass | 01/AC2-docs-rule-and-review.txt: AGENTS.md:65 covers only behaviour someone can notice (refactor/test-only/rename draws no finding) and makes a visible change w |  |
| 01.AC3 | pass | 01/AC3-norn-pr-docs-line.txt: norn-pr SKILL.md:39 has `**Docs:** <the repo's docs this change touched, or why none needed to change>`, guidance generic (no norn |  |
| 01.AC4 | pass | 01/AC4-concepts.txt: concepts.md's review, ready/on:, signals vcs.stale and entries examples match the shipped pack (shared/build.yaml, shared/land.yaml, fix/qu |  |
| 01.AC5 | pass | 01/AC5-readme.txt: README.md:92, before the `norn watch` block, warns auto mode costs money, gives `norn config set kernel.mode manual`, explains watch vs a han |  |
| 01.AC6 | pass | 01/AC6-kernel-mode.txt: reference.md:868 explains kernel default `manual` vs init's `auto` with the headless runner; static/docs-emit.txt leaves the tree clean |  |
| 01.AC7 | pass | 01/AC7-norn-retro-user-docs.txt: norn-retro SKILL.md:72 '8. User docs that misled', and the table row at :95 turns it into a suggested change |  |
| 02.AC1 | pass | Judged as human-qa #3 redefines it (when: dropped, description: says when to pick): 02/AC1-AC4-live-and-schema.txt: emitted workflow-source schema has no `when` | The reworded pack descriptions are part of each workflow's hash: all 7 pack hashes move against origin/main's pack files (02/AC2-AC3-hash-main-code-vs-head-code.txt). Units in flight keep their pinned document; golden un |
| 02.AC2 | pass | static/golden-update.txt: golden --update changes no case; 02/AC2-AC3-hash-main-code-vs-head-code.txt: HEAD's code and origin/main's code give the same hash for |  |
| 02.AC3 | pass | 02/AC2-AC3-hash-main-code-vs-head-code.txt: HEAD's loader returns `included` (step → shared file, e.g. implement→build, ready→land) with hashes identical to mai |  |
| 02.AC4 | pass | Withdrawn by human-qa #3; judged as it redefines it: 02/AC4-no-when-anywhere.txt: no `when:` in pack workflows, .agents/workflows, schema or loader; hash strip  |  |
| 02.AC5 | pass | 02/AC5-use-when.txt: all 20 pack skill descriptions say 'Use when/for'; mutations/mutations-a.txt: rewording norn-fsd's clause fails plugin.test.ts 'every bundl |  |
| 02.AC6 | pass | 02/AC6-marker-pair-emit.txt + static/docs-emit.txt: docs:emit leaves reference.md byte-identical and the tree clean; marker-pair test and stale check pass |  |
| 03.AC1 | pass | 03/AC1-AC3-workflow-catalog.txt: reference.md:872's generated Workflow catalog gives all 7 workflows with label, start step and description |  |
| 03.AC2 | pass | 03/AC2-skills-table.txt: Skills table lists all 20 skills with Use clause; only norn-fsd marked '(a person's)' |  |
| 03.AC3 | pass | 03/AC1-AC3-workflow-catalog.txt: each workflow has a Step / Kind / Skills table |  |
| 03.AC4 | pass | mutations/mutations-a.txt: changing norn-tdd's Use clause, quick's description or build.yaml's review skills without docs:emit each fails the stale check |  |
| 03.AC5 | pass | 03/AC5-contributing-table.txt: CONTRIBUTING.md:18-31 generated norn:workflows block includes `release` from .agents/workflows; mutations-a.txt: changing release |  |
| 03.AC6 | pass | mutations/mutations-a.txt: a copied workflow table in norn-triage SKILL.md or triage.yaml's do: fails 'carry no table of workflows of their own'; removing 'work |  |
| 04.AC1 | pass | 04/AC1-AC3-workflows-page.md: docs/workflows.md has a main graph per shipped workflow (7) plus each shared part's own diagram, 27 mermaid blocks; reference.md:8 |  |
| 04.AC2 | pass | As human-qa #3 redefines it: 04/AC1-AC3-workflows-page.md: every use: group (catch-up, diagnose, build, base-update, publish, land) is one node in the main grap | Story's main path wraps into two rows and qa appears at the end of row 1 and start of row 2 (the page's legend explains it). Gates of fix/quick sit inside the collapsed land node, so they show only in the land diagram, a |
| 04.AC3 | pass | As human-qa #3 redefines it: 04/AC1-AC3-workflows-page.md and 04/AC5-*.png: flowchart LR, one node per step with kind·role, gates hexagons, checks parallelogram |  |
| 04.AC4 | pass | mutations/mutations-b.txt (04/AC4-stale-check-mutation.txt): changing quick.yaml's publish max or build.yaml's review role without docs:emit fails 'docs/workflo |  |
| 04.AC5 | pass | 04/AC5-github-render.md/.json + 04/AC5-*.png: docs/ at HEAD equals docs/ at PR #518's head d5f455185; headless Chromium on github.com rendered 27 of 27 mermaid  |  |
| 05.AC1 | pass | 05/AC1-workflow-list.md: with a quick override (+polish), a new repo workflow, a held story override and an invalid one, `workflow list` shows each with source  |  |
| 05.AC2 | pass | 05/AC2-workflow-show-quick.md: `workflow show quick` prints resolved steps incl. polish, outcome → step with counters and maxima, gates, skills per step; held s |  |
| 05.AC3 | pass | 05/AC3-skill-list.md: 20 pack skills, repo-skill from `repo (.agents/skills/repo-skill)`, harness-only from `claude (.claude/skills/harness-only)`, each with Us |  |
| 05.AC4 | pass | 05/AC4-validate.md: every --json output (list, show ok/held, skill list) passes assertValid against its schema, in and outside a repo; a negative control is rej |  |
| 05.AC5 | pass | 05/AC5-read-only.md: hashes of repo files incl .agents/.claude, .git (but index) and NORN_HOME identical before/after 17 command runs (diff empty) |  |
| 05.AC6 | pass | 05/AC6-not-a-repo.md: in a plain dir all three commands exit 0 with 7 pack workflows and 20 skills, saying 'Not in a norn repo …'; JSON repo:null | `workflow show nope`'s do_instead leaves out the held `story`, while `story create --workflow nope` includes it (05/AC7-mistyped.md). Minor. |
| 05.AC7 | pass | 05/AC7-mistyped.md: `workflow show nope --json` and `story create "x" --workflow nope --json` exit 3, code unknown_workflow, do_instead naming valid workflows |  |
| 05.AC8 | pass | 05/AC8-mermaid.md: `workflow show quick --mermaid` on the override draws polish in the same LR form; pack quick graph byte-identical to the docs block |  |
| 05.AC9 | pass | 05/AC9-reference.md: reference.md:650-689 documents workflow list, workflow show <name> [--mermaid], skill list; reference/catalog tests 30 pass |  |
| 06.AC1 | pass | 06/AC1-tick-captions.txt: `norn tick` prints e.g. `intake.story → intake_story: an open tracker item becomes a new story`; tick --json has no caption key; watch |  |
| 06.AC2 | pass | 06/AC2-captions-test.txt + mutations-a.txt: removing claim.pending's caption fails 'every rule id decide can name has a caption'; adding qa.bogus fails 'no capt |  |
| 07.AC1 | pass | 07/AC1-AC4-suites.txt: packages/conformance/test/unit/lab.test.ts, harnessConformance over the lab's recordings: 144 pass, 0 fail |  |
| 07.AC2 | pass | 07/AC2-binary-no-bun.txt: with norn compiled (bun scripts/build.ts --bin darwin-arm64) and env -i PATH=/usr/bin:/bin:<bindir> (no bun), the lab played to beat 3 |  |
| 07.AC3 | pass | 07/AC3-bundled.txt: the lab config names `executors: lab: {harness: lab, runner: headless}`, the lab home has no plugins dir, and doctor reports config ok (exec |  |
| 07.AC4 | pass | 07/AC1-AC4-suites.txt: harness-lab unit suites 16 pass; live, every lab's stand-in committed 'Greet the world', reported done, then asked with norn ask (status  |  |
| 07.AC5 | pass | 07/AC5-lab-agent-outside.txt: outside a lab run `norn lab-agent --json` is refused, exit 3, code not_lab_run, do_instead naming `norn lab`; same from the compil |  |
| 08.AC1 | pass | 08/AC1-AC2-beat1.txt: $TMPDIR/norn-lab holds repo (greet.sh, test.sh), bare remote.git as origin, own home; config tracker local, forge none, store local, execu |  |
| 08.AC2 | pass | 08/AC2-beat1-claim.txt, 08/AC1-AC2-beat1.txt: beat 1's ticks cut branch norn/lt-1 with its worktree under the lab home and take the claim (status --json holder) |  |
| 08.AC3 | pass | 08/AC3-check-counter.txt, 08/status-beat3.txt: implement att 1 → check (receipt check.finished fail) → implement att 2 with check.fail {value 1, max 5} |  |
| 08.AC4 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab.test.ts AC4 passed at d5f455185,  |
| 08.AC5 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab.test.ts AC5 passed at d5f455185,  |
| 08.AC6 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab.test.ts AC6 passed at d5f455185,  |
| 08.AC7 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab.test.ts AC7 passed at d5f455185,  |
| 08.AC8 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab.test.ts AC8 passed at d5f455185,  |
| 08.AC9 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab.test.ts AC9 passed at d5f455185,  |
| 08.AC10 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab.test.ts AC10 passed at d5f455185, |
| 08.AC11 | pass | 08/AC11-isolation.txt: shasum of the person's NORN_HOME_DIR (still empty) and a sibling repo incl .git identical before/after six labs; two labs side by side ha |  |
| 08.AC12 | pass | 08/AC12-resume.txt: lab stopped at beat 3 then run again: `built:false`, beat 3, 'Resumed the lab'; `--clean` gives built:true, beat 1, old worktree/branch gone |  |
| 08.AC13 | pass | 08/AC1-AC2-beat1.txt: one `lab: { harness: lab, runner: headless }` executors line with the comment saying how to swap a real harness in |  |
| 08.AC14 | pass | 08/AC14-captions.txt: each of the 8 beats in packages/pack-sdlc/assets/lab/script.yaml has a caption of what norn did and a `look` naming a command, status fiel | The captions read well on their own; their timing in the --tty tour is the 09.AC4 failure. |
| 09.AC1 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab-tty.test.ts timed out at 600 s at |
| 09.AC2 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab-tty.test.ts timed out at 600 s at |
| 09.AC3 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab-tty.test.ts timed out at 600 s at |
| 09.AC4 | fail | 09/AC4-tour-pause-beat2.txt, 09/AC4-tty-tour-and-docs.txt | In a fresh TMPDIR with an empty NORN_HOME_DIR run `bun packages/cli/src/main.ts lab --tty`. At beat 1 press Enter. At 'Beat 2 of 8: A check fails and loops back … Look: norn status --json: the unit's counters, where chec |
| 10.AC1 | pass | 10/AC1-serve.txt: plain `norn lab` printed http://127.0.0.1:51851/, lsof shows 127.0.0.1 only, no browser launched |  |
| 10.AC2 | pass | 10/AC2-port-taken.txt: a second lab on taken port 47631 refused port_taken naming the port, exit 3, nothing built; first lab kept serving |  |
| 10.AC3 | pass | 10/AC3-graph-live.txt, 10/AC3-live-step.png, 10/AC11-beat3.png: at beat 3 graph.workflow quick, graph.live implement (= status); LR main path, only build expand |  |
| 10.AC4 | pass | 10/AC4-decisions.txt: all 15 decisions shown with a plain-word caption | At a needs-you beat the decisions panel can read 'No decision yet.' after ~2.5 min (newest 60 traces, unit.parked hidden): accepted as a follow-up at human-qa #5. |
| 10.AC5 | pass | 10/AC5-receipts.txt: receipts seq 1-11 in write order, each run.started marked 'before: the run is launched', state.committed last |  |
| 10.AC6 | pass | 10/AC6-needs-you.txt: needs_you (lt-1, answer, question, `norn story answer lt-1 "<answer>"`) equals status --json's waiting |  |
| 10.AC7 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. the worktree's pr.md exists only after des |
| 10.AC8 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. CI's lab-serve.test.ts (AC1, AC2, AC8, AC9 |
| 10.AC9 | pass | 10/AC9-reset.txt: Reset at beat 3 ran `norn lab --clean`, exit 0, 'Built a new lab'; state went beat 3 → beat 1, new repo/home |  |
| 10.AC10 | pass | 10/AC10-http-refusals.txt: foreign Host 403, foreign Origin 403, cross-site 403, non-JSON 415 not_json, unknown button 404, GET on button 405, missing input 400 |  |
| 10.AC11 | person | 10/AC11-beat3.png | Look at 10/AC11-beat3.png, AC11-beat3-graph.png and AC11-beat3-full.png (1280x800, beat 3 on HEAD) and 04/AC5-*.png (GitHub docs width): main path LR, only build expanded, implement lit, badges, no stuck edges. Approved  |
| 10.AC12 | person | 10/AC12-readme-try-this.md | README's 'Try this' (line 26) starts with norn lab, GIF right after it; docs/assets/norn-lab.gif 800x538, 47 frames, 61 s (10/AC12-gif-contact-sheet.png). Approved at human-qa #4/#5; confirm the GIF still shows the 8 bea |
| 11.AC1 | pass | 11/AC1-kill.txt: kill during implement ran `kill -s KILL -- -20950`, group gone; next tick agent.died.retry and a fresh session 21187 |  |
| 11.AC2 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. Pressed here, each switch answered with it |
| 11.AC3 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. Pressed here, each switch answered with it |
| 11.AC4 | pass | 11/AC4-corrupt.txt: corrupt kept a copy and overwrote state.json; status --json shows the unit corrupt; way out `cp <kept> <state.json>` named |  |
| 11.AC5 | unverified | ci/ci-d5f455185-lab-summary.txt | the beat sits behind a person-only command (norn story answer/approve/reject, run rerun, story take), refused with person_only in this agent session; the guard was not bypassed. Pressed here, each switch answered with it |
| 11.AC6 | pass | 11/AC1-kill.txt, 11/AC4-corrupt.txt, 11/AC6-fail-check-move-base-expire-claim.txt: each of the five switches answers with the exact command it ran and a way out |  |
| 11.AC7 | pass | 11/AC7-isolation.txt: every path a switch named is inside the lab; a sibling repo, the person NORN_HOME_DIRs and the worktree status hash identical before/after |  |
