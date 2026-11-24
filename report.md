# QA #8 of gh-517 at 9a1ded9e2

Only product change since QA #7: packages/cli/src/lab/tty.ts (+ --tty help/docs). Every criterion re-observed on HEAD.

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 | pass | mutations/mutations.txt (M1, M1b): removing AGENTS.md's Docs rule, or its 'or why none', fails test/repo/process.test.ts; restored it passes |  |
| 01.AC2 | pass | 01/AC1-AC2-AC3-AC7-texts.txt: AGENTS.md:65 limits the rule to noticeable behaviour; norn-review's Standards axis cites documented rules |  |
| 01.AC3 | pass | 01/AC1-AC2-AC3-AC7-texts.txt: norn-pr body has '**Docs:** <docs touched, or why none>' and a generic Docs section |  |
| 01.AC4 | pass | 01/AC4-concepts.txt: concepts.md examples match the shipped workflows (review approve exit, ready on:, signals:, entries), stale approve/update/remind removed |  |
| 01.AC5 | pass | 01/AC5-readme.md: before norn watch the README says auto mode costs money and gives `norn config set kernel.mode manual`; live init writes auto+headless and the |  |
| 01.AC6 | pass | 01/AC6-kernel-mode.txt: reference.md explains kernel default manual vs init auto; hand edit and dropped reason each fail tests (mutations) |  |
| 01.AC7 | pass | 01/AC1-AC2-AC3-AC7-texts.txt: norn-retro step 8 'User docs that misled' and its table row |  |
| 02.AC1 | pass | Judged as human-qa #3 redefines it (when: dropped): 02/AC1-AC4-schema-and-grep.txt: workflow schema has no when and is closed; a repo workflow with when: is lis |  |
| 02.AC2 | pass | 02/AC2-AC3-hashes.txt: same workflow files hash byte-identically under origin/main's and HEAD's code (7 workflows); static/golden-update.log: golden --update ch |  |
| 02.AC3 | pass | 02/AC2-AC3-hashes.txt: HEAD's loader reports included (step -> shared file) without moving hashes; 'included stays out of the pinned document' passes |  |
| 02.AC4 | pass | Withdrawn by human-qa #3 and judged as redefined: 02/AC1-AC4-schema-and-grep.txt no when: anywhere; every description says when; mutations M4a/M4b fail the test |  |
| 02.AC5 | pass | 02/AC5-skill-descriptions.txt: all 20 pack skills carry Use when/for; mutation M3 fails plugin.test.ts |  |
| 02.AC6 | pass | 02/AC6-markers.txt: replaceReference/currentReference take a MarkerPair; reference.test 21/21; docs:emit byte-identical (static/emit.log) |  |
| 03.AC1 | pass | 03/AC1-AC3-catalog-excerpt.md: all 7 pack workflows with description, start step, norn:wf label (no When field per ruling) |  |
| 03.AC2 | pass | 03/AC1-AC3-catalog-excerpt.md: 20 skills with Use clause; only norn-fsd marked (a person's) |  |
| 03.AC3 | pass | 03/AC1-AC3-catalog-excerpt.md: Step/Kind/Skills table per workflow incl. shared-file steps |  |
| 03.AC4 | pass | mutations/mutations.txt M5a-c: changed Use clause, description, or step skill without re-emitting each fails 'docs/reference.md is up to date' |  |
| 03.AC5 | pass | 03/AC5-contributing-table.md: CONTRIBUTING.md generated norn:workflows block includes release from .agents/workflows/ (Description column per ruling); M6 fails  |  |
| 03.AC6 | pass | 03/AC6-triage-texts.txt: norn-triage and both triage.yaml point at the catalog, no table; copied table fails the lint (M7a/b'/e) |  |
| 04.AC1 | pass | 04/AC1-AC3-workflows-page.md: docs/workflows.md has a main graph per shipped workflow (27 mermaid blocks), linked from reference; docs:emit no diff |  |
| 04.AC2 | pass | As human-qa #3 redefines it: 04/AC1-AC3-workflows-page.md: each use: group one node in the main graph, expanded in its own diagram |  |
| 04.AC3 | pass | As human-qa #3 redefines it: 04/AC1-AC3-workflows-page.md, 04/AC5-story.png: flowchart LR, kind and role per node, gates/checks marked, labelled back-edges, cou |  |
| 04.AC4 | pass | 04/AC4-stale-check.md: three mutations each fail 'docs/workflows.md is up to date'; green once restored |  |
| 04.AC5 | pass | 04/AC5-github-render.md/.json, 04/AC5-page-*.png: docs/workflows.md identical to PR #518 head d5f455185; on GitHub 27 Mermaid frames, 27 drawn, 0 errors |  |
| 05.AC1 | pass | 05/AC1-workflow-list.md: each workflow with description and source (replaces pack, repo, pack); held own names `norn workflow confirm own` |  |
| 05.AC2 | pass | 05/AC2-workflow-show-quick.md: resolved override steps, outcome->step with counters, maxima, gates, skills |  |
| 05.AC3 | pass | 05/AC3-skill-list.md: 20 pack skills, a repo skill and a claude-only skill, each with its source and Use clause |  |
| 05.AC4 | pass | 05/AC4-validate.md: 9 --json outputs pass assertValid against workflow-list/workflow-show/skill-list |  |
| 05.AC5 | pass | 05/AC5-readonly.md: hashes of repo, config, run state and home identical before/after 13 read commands |  |
| 05.AC6 | pass | 05/AC6-not-a-repo.md: outside a repo all commands exit 0, show the pack's 7 workflows and 20 skills, say no repo overrides were read |  |
| 05.AC7 | pass | 05/AC7-mistyped.md: workflow show nope and story create --workflow nope exit 3, code unknown_workflow, do_instead names valid workflows |  |
| 05.AC8 | pass | 05/AC8-mermaid.md: --mermaid prints the page's form; 6 of 7 pack workflows byte-identical to the page (story wraps rows on the page only) |  |
| 05.AC9 | pass | 05/AC9-reference.md: reference documents workflow list, workflow show [--mermaid], skill list |  |
| 06.AC1 | pass | 06/AC1-tick.md: tick markdown prints rule id -> caption; --json and watch lines carry no caption |  |
| 06.AC2 | pass | 06/AC2-mutations.md: captions.test fails on a removed caption, a bogus caption and a new uncaptioned rule id |  |
| 07.AC1 | pass | 07/AC1-AC4-suites.txt: conformance lab.test.ts 144 pass, 0 fail over 13 recordings |  |
| 07.AC2 | pass | 07/AC2-binary-and-script.txt: compiled binary with no bun on PATH plays beats 1-3; the stand-in runs via the shim |  |
| 07.AC3 | pass | 07/AC3-bundled.txt: no plugins dir; doctor passes with executor lab; plugin list shows norn-harness-lab (bundled) |  |
| 07.AC4 | pass | 07/AC1-AC4-suites.txt: harness-lab 16 pass; live receipts show session, done, then ask |  |
| 07.AC5 | pass | 07/AC5-lab-agent-outside.txt: lab-agent --json outside a lab run refused not_lab_run, exit 3, do_instead norn lab |  |
| 08.AC1 | pass | 08/AC1-AC3-layout-beats.txt: norn-lab holds repo (greet.sh, test.sh), bare remote.git, own home; config local tracker, forge none, check sh test.sh, executor la |  |
| 08.AC2 | pass | 08/AC1-AC3-layout-beats.txt, 08/status-beat3.json, 08/story-view-beat3.json: claim, branch norn/lt-1 and its worktree |  |
| 08.AC3 | pass | 08/AC1-AC3-layout-beats.txt: check failed on 'hello world', implement attempt 2, check.fail {1, max 5} |  |
| 08.AC4 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 08.AC5 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 08.AC6 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 08.AC7 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 08.AC8 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 08.AC9 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 08.AC10 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 08.AC11 | pass | 08/AC11-isolation.txt: person NORN_HOME_DIR and sibling repo (28 files) hash identical across three plays; two labs side by side share nothing |  |
| 08.AC12 | pass | 08/AC12-resume.txt: second lab --tty prints 'Resumed the lab' at Beat 3; --clean starts at Beat 1 |  |
| 08.AC13 | pass | 08/AC13-executor-line.txt: one executors line lab: {harness: lab, runner: headless} with a comment naming the real-harness setting |  |
| 08.AC14 | pass | 08/AC14-captions.txt: all 8 beats have a caption and a look; beats 1-3 printed live |  |
| 09.AC1 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 09.AC2 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 09.AC3 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 09.AC4 | unverified | 09/AC4.md |  |
| 10.AC1 | pass | 10/AC1-serve.txt: plain norn lab served http://127.0.0.1:65147/, listening on 127.0.0.1 only, no browser opened |  |
| 10.AC2 | pass | 10/AC2-port.txt: --port 47391 served there; a second lab on it refused port_taken naming the port, exit 3, built nothing; reference documents --port |  |
| 10.AC3 | pass | 10/AC3-AC6-state.txt, 10/state-beat3.json, 10/AC11-beat3.png: graph.workflow quick, graph.live implement |  |
| 10.AC4 | pass | 10/AC3-AC6-state.txt: 15 decisions, each with a plain-word caption |  |
| 10.AC5 | pass | 10/AC3-AC6-state.txt: receipts seq 1-11 in order, each before its effect, state.committed last |  |
| 10.AC6 | pass | 10/AC3-AC6-state.txt, 10/status-beat3.json: needs_you equals status --json waiting |  |
| 10.AC7 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 10.AC8 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 10.AC9 | pass | 10/AC9-reset.txt: Reset ran norn lab --clean (exit 0), beat 3 -> 1 |  |
| 10.AC10 | pass | 10/AC10-http.txt: foreign Host 403, foreign Origin/cross-site 403, non-JSON 415, unknown button 404, wrong method 405, missing input 400 |  |
| 10.AC11 | person | 10/AC11-beat3.png |  |
| 10.AC12 | person | 10/AC12-readme-try-this.md |  |
| 11.AC1 | pass | 11/AC1-kill.txt: kill during implement killed the process group; next tick agent.died.retry started a fresh session |  |
| 11.AC2 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 11.AC3 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 11.AC4 | pass | 11/AC4-corrupt.txt: unit shows corrupt under Needs you; the named cp restores it |  |
| 11.AC5 | unverified | ci/ci-d5f455185-lab-summary.txt | person-only beat |
| 11.AC6 | pass | 11/AC6-switches.txt: all five switches answer with command, exit 0 and way out |  |
| 11.AC7 | pass | 11/AC7-paths.txt: every switch command names only lab paths; person home and sibling unchanged |  |
