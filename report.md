# QA #6 of gh-517 at d5f455185

Product code is identical to 65df6ba16 (QA #5); only test files changed (static/product-diff-since-qa5.txt). Every criterion was re-observed on HEAD.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 | pass | mutations/mutations.txt: removing AGENTS.md's Docs rule fails test/repo/process.test.ts ('AGENTS.md's Rules hold the docs rule'); restored,  |  |
| 01.AC2 | pass | 01/AC1-AC2-AC3-AC7-texts.txt: AGENTS.md:65 covers only behaviour someone can notice: a refactor, test-only change or internal rename draws n |  |
| 01.AC3 | pass | 01/AC1-AC2-AC3-AC7-texts.txt: norn-pr SKILL.md:39 has the line `**Docs:** <the repo's docs this change touched, or why none needed to change |  |
| 01.AC4 | pass | 01/AC4-concepts.txt: concepts.md's review example (by: reviewer; code:read, docs:write; approve: {exit: reviewed}), `signals: { vcs.stale: { |  |
| 01.AC5 | pass | 01/AC5-readme.md: before `norn watch`, README says auto mode launches agents that cost money, that `norn config set kernel.mode manual` star |  |
| 01.AC6 | pass | 01/AC6-kernel-mode.txt: reference.md:868 explains the kernel default `manual` vs init's `auto` with the headless runner. static/emit.log + s |  |
| 01.AC7 | pass | 01/AC1-AC2-AC3-AC7-texts.txt: norn-retro SKILL.md:72 '8. User docs that misled', and its table row (line 95) turns the passage into a sugges |  |
| 02.AC1 | pass | Judged as human-qa #3 redefines it (the when: key is dropped): 02/AC1-AC4-schema-and-grep.txt shows workflow-source.schema.json's top-level  | The pack workflows' descriptions are part of the hash: rewording them, as human-qa #3 asked, moves every pack workflow's hash against origin/main's pack (02/AC2 |
| 02.AC2 | pass | static/golden-update.log: `bun run golden -- --update` changes no case. 02/AC3-hash-main-code-vs-head-code.txt: the same workflow files pin  |  |
| 02.AC3 | pass | 02/AC3-hash-main-code-vs-head-code.txt: six workflows (quick, story, fix, triage, refinement, reproduce, all built from shared files), loade |  |
| 02.AC4 | pass | Withdrawn by human-qa #3 and judged as it redefines it: 02/AC1-AC4-schema-and-grep.txt finds no `when:` in packages/pack-sdlc/assets/workflo |  |
| 02.AC5 | pass | mutations/mutations.txt: rewording norn-fsd's 'Use when' fails pack-sdlc plugin.test 'every bundled skill's description says when it applies |  |
| 02.AC6 | pass | static/emit.log + static/git-status-after-emit.txt: docs:emit at HEAD leaves docs/reference.md byte-identical (0 changed files), and its sta |  |
| 03.AC1 | pass | 03/AC1-AC3-catalog-excerpt.md: the reference's Workflow catalog has each pack workflow (fix, quick, refinement, reproduce, slice, story, tri |  |
| 03.AC2 | pass | 03/AC1-AC3-catalog-excerpt.md: the Skills table lists all 20 pack skills, each with its Use clause; norn-fsd is marked '(a person's)' |  |
| 03.AC3 | pass | 03/AC1-AC3-catalog-excerpt.md: each workflow has a Step / Kind / Skills table (e.g. `implement` agent (builder) `norn-implement`) |  |
| 03.AC4 | pass | mutations/mutations.txt: changing norn-tdd's Use clause fails 'the stale check fails when a pack workflow or skill changes without re-emitti |  |
| 03.AC5 | pass | 03/AC5-contributing-table.md: CONTRIBUTING.md's generated block (norn:workflows markers) lists release from .agents/workflows/ beside the pa |  |
| 03.AC6 | pass | mutations/mutations.txt: a copied workflow table appended to norn-triage/SKILL.md fails test/repo/workflow-texts.test.ts ('the triage skill  |  |
| 04.AC1 | pass | 04/AC1-AC3-workflows-page.txt: docs/workflows.md has one `## <workflow>` graph for each of the 7 shipped workflows plus each shared part's o |  |
| 04.AC2 | pass | As human-qa #3 redefines it (each shared part collapsed to one node, expanded in its own diagram): 05/AC8-quick-mermaid.txt draws catch-up,  |  |
| 04.AC3 | pass | As human-qa #3 redefines it: 04/AC1-AC3-workflows-page.txt and 04/AC5-github-graph22.png show each step's kind and role (update-branch, agen |  |
| 04.AC4 | pass | mutations/mutations.txt: changing quick.yaml without docs:emit fails 'docs/workflows.md is up to date (bun run docs:emit)'; restored, it pas |  |
| 04.AC5 | pass | 04/AC5-github-render.json: headless Chromium opened docs/workflows.md on github.com at PR #518's head 65df6ba16, whose docs/ is identical to |  |
| 05.AC1 | pass | 05/AC1-workflow-list.md: in a repo with a quick override, a new repo workflow (docs-only) and a held story override: each workflow is listed |  |
| 05.AC2 | pass | 05/AC2-workflow-show-quick.md: the override's resolved steps, its added polish step included, each outcome → step, counters with their maxim |  |
| 05.AC3 | pass | 05/AC3-skill-list.md: the pack skills, repo-skill from `repo (.agents/skills/repo-skill)` and harness-only from `claude (.claude/skills/harn |  |
| 05.AC4 | pass | 05/AC4-validate.txt: workflow list, workflow show (an ok and a held one) and skill list --json each pass assertValid against workflow-list,  |  |
| 05.AC5 | pass | 05/AC5-before.txt vs 05/AC5-after.txt (05/AC5-diff.txt empty): shasum of the repo's files, .agents and .claude, and the norn home's run stat |  |
| 05.AC6 | pass | 05/AC6-not-a-repo.md: in a plain directory, all three commands exit 0 and show the pack's 7 workflows and 20 skills. They say 'Not in a norn | `workflow show nope` names the startable workflows without the held `story`, while `story create --workflow nope` includes it (05/AC7-mistyped.txt). Minor, and  |
| 05.AC7 | pass | 05/AC7-mistyped.txt: `workflow show nope --json` and `story create "x" --workflow nope --json` both exit 3 with code unknown_workflow, and d |  |
| 05.AC8 | pass | 05/AC8-quick-mermaid.txt: `workflow show quick --mermaid` on the repo's own quick.yaml prints its graph in the same `flowchart LR` form, cla |  |
| 05.AC9 | pass | static/reference-grep.txt: the reference documents `norn workflow list`, `norn workflow show <name> [--mermaid]` with --mermaid, and `norn s |  |
| 06.AC1 | pass | 06/AC1-tick.md: `norn tick` prints `lt-1  intake.story → intake_story: an open tracker item becomes a new story`. The next tick's --json dec |  |
| 06.AC2 | pass | mutations/mutations.txt: removing claim.pending's caption fails 'every rule id decide can name has a caption'; adding qa.bogus fails 'no cap |  |
| 07.AC1 | pass | 07/AC1-AC4-suites.txt: packages/conformance/test/unit/lab.test.ts, harnessConformance over the lab's recordings: 144 pass, 0 fail |  |
| 07.AC2 | pass | 07/AC2-binary-and-script.txt: with norn compiled (bun scripts/build.ts --bin darwin-arm64) and PATH=/usr/bin:/bin plus the binary only (no b |  |
| 07.AC3 | pass | 07/AC3-bundled.txt: the lab config is `executors: lab: {harness: lab, runner: headless}`, with no plugins dir in the lab home. doctor: execu |  |
| 07.AC4 | pass | 07/AC1-AC4-suites.txt: the harness-lab unit suite over the in-memory host, 16 pass. Live: the lab's sessions committed 'Greet the world' and |  |
| 07.AC5 | pass | 07/AC5-lab-agent-outside.txt: outside a lab run, `norn lab-agent --json` is refused with code not_lab_run, exit 3, and do_instead 'run `norn |  |
| 08.AC1 | pass | 08/AC1-AC2-layout.txt: $TMPDIR/norn-lab/ holds repo (greet.sh, test.sh), remote.git and home. The config has the local tracker, forge none,  |  |
| 08.AC2 | pass | 08/AC1-AC2-layout.txt: branch norn/lt-1 and its worktree under the lab home in `git worktree list`; claim in 08/status-beat3.json |  |
| 08.AC3 | pass | 08/status-beat3.json: counters check.fail {value 1, max 5}, implement attempt 2. 10/state-beat3.json receipts: check.finished (seq 8), then  |  |
| 08.AC4 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 08.AC5 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 08.AC6 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 08.AC7 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 08.AC8 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 08.AC9 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 08.AC10 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 08.AC11 | pass | 08/AC11-isolation.txt: the person's NORN_HOME_DIR stays empty, and a sibling repo plus that home (27 files hashed) are unchanged across two  |  |
| 08.AC12 | pass | 08/AC12-resume.txt: lab 1 stopped at beat 3 and run again prints 'Resumed the lab' and Beat 3 of 8. 10/AC9-reset.txt: Reset runs `norn lab - |  |
| 08.AC13 | pass | 08/AC1-AC2-layout.txt: one `lab: { harness: lab, runner: headless }` executors line, with the comment saying how to set a real harness. stat |  |
| 08.AC14 | pass | 08/AC14-captions.txt: each of the 8 beats in packages/pack-sdlc/assets/lab/script.yaml has a caption saying what norn did, and a `look` nami |  |
| 09.AC1 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 09.AC2 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 09.AC3 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 09.AC4 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 10.AC1 | pass | 10/AC1-serve.txt: plain `norn lab` printed http://127.0.0.1:65152/, and lsof shows it listening on 127.0.0.1 only. No browser opened (headle |  |
| 10.AC2 | pass | 10/AC2-port-taken.txt: `--port 47391` while lab 1 holds it is refused with port_taken, naming the port, exit 3, and nothing is built. Lab 1  |  |
| 10.AC3 | pass | 10/state-beat3.json: graph.workflow quick, graph.live implement. 10/AC11-beat3-viewport.png lights implement inside the opened build part |  |
| 10.AC4 | pass | 10/AC4-state-lab2-early.json: every decision the panel reads carries its caption (intake.story 'an open tracker item becomes a new story', c | The panel reads only the newest 60 tick traces and hides standing decisions (unit.parked). After about 2.5 min at a needs-you beat, it shows 'No decision yet.'  |
| 10.AC5 | pass | 10/state-beat3.json receipts: seq 1-11 in order, each run.started marked before 'the run is launched', the second run.started of a run worde |  |
| 10.AC6 | pass | 10/state-beat3.json needs_you (lt-1, for answer, the question, `norn story answer lt-1 "<answer>"`) equals status --json's waiting for lt-1  |  |
| 10.AC7 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 10.AC8 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 10.AC9 | pass | 10/AC9-reset.txt: in lab 2 at beat 3, Reset ran `norn lab --clean` (exit 0, 'Built a new lab'), and the state's beat went 3 → 1 |  |
| 10.AC10 | pass | 10/AC8-AC10-http.txt: a foreign Host gets 403, a foreign Origin 403 foreign_origin, a non-JSON body 415 not_json, an unknown button 404 unkn |  |
| 10.AC11 | person | 10/AC11-beat3-viewport.png |  |
| 10.AC12 | person | 10/AC12-readme-try-this.md |  |
| 11.AC1 | pass | 11/AC1-kill.txt: after Reset in lab 2, the kill button pressed during implement ran `kill -s KILL -- -61368`. The lab-agent process was gone |  |
| 11.AC2 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 11.AC3 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 11.AC4 | pass | 11/AC4-corrupt.txt: the button kept a copy of the unit's state.json, overwrote the file and named the way out (cp the kept copy back). `norn |  |
| 11.AC5 | unverified | see reason | person-only beats; CI evidence in ci/ |
| 11.AC6 | pass | 11/AC1-kill.txt, 11/AC4-corrupt.txt, 11/AC2-AC3-AC5-AC6-switches.txt: each of the five switches answers with the command it ran and its way  |  |
| 11.AC7 | pass | 11/*.txt: every switch's command names only the lab's repo, remote, worktree or home. 08/AC11-isolation.txt: the sibling repo and the person |  |
