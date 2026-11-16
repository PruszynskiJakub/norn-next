# QA #2 gh-343 on 3af53e1

| Criterion | Verdict | Evidence | Note |
|---|---|---|---|
| 01.AC1 Given a workflow file in today's wording, when it is loaded from the main checkout, from a unit's pin, from a  | unverified | 01.AC1.md | the cli integration tests for the trace, record and restart readers have not run on this h |
| 01.AC2 Given each of those readers, when it loads a workflow, then a test at the store loading seam shows it asked fo | pass | 01.AC2.md |  |
| 02.AC1 Given an agent step with one skill, when its brief is rendered, then Your work reads "Use the `X` skill." foll | pass | 02.AC1.md |  |
| 02.AC2 Given an agent step with two skills, when its brief is rendered, then Your work reads "Use the `X` and `Y` ski | pass | 02.AC2.md |  |
| 02.AC3 Given an agent step with no skills, when its brief is rendered, then Your work names no skill and gives only t | pass | 02.AC3.md |  |
| 02.AC4 Given a workflow whose agent step lists a skill that is not installed, or not visible to the agent that runs t | pass | 02.AC4.md |  |
| 02.AC5 Given a story being refined again, when decide reads its workflow, then it recognises the refine step by the s | pass | 02.AC5.md |  |
| 02.AC6 Given the golden cases with their embedded workflows rewritten from one skill to a list, when the golden suite | pass | 02.AC6.md |  |
| 03.AC1 Given each shipped workflow and shared file in today's wording, when translated, then the output equals a hand | pass | 03.AC1.md |  |
| 03.AC2 Given folded and block scalars, long lines and quoted strings in a fixture, when translated, then none is re-w | pass | 03.AC2.md |  |
| 03.AC3 Given an agent step with `skill: X` and `instructions`, when translated, then it reads `agent: <the instructio | pass | 03.AC3.md |  |
| 03.AC4 Given an agent step with a skill and no instructions, when translated, then its orientation is its `descriptio | pass | 03.AC4.md |  |
| 03.AC5 Given a long edge `{ to, counter, means, verdict }`, when translated, then `outcomes:` keeps only `to`/`counte | pass | 03.AC5.md |  |
| 03.AC6 Given a step whose `agent: <name>` picks its agent, when translated, then it reads `by: <name>`. | pass | 03.AC6.md |  |
| 03.AC7 Given a comment the translation leaves with no node to sit on, when translated, then the file is refused with  | pass | 03.AC7.md |  |
| 03.AC8 Given a translated text, or any text already in the new wording, when translated again, then it comes back unc | pass | 03.AC8.md |  |
| 03.AC9 Given a workflow written as JSON, when translated, then the output is JSON with two-space indent and its key o | pass | 03.AC9.md |  |
| 04.AC1 Given an agent step `agent: <orientation>` with `skills`, `inputs`, `outcomes`, `means`, `verdict`, `by`, `mod | pass | 04.AC1.md |  |
| 04.AC2 Given each verb `update-branch:`, `open-pr:`, `integrate:`, `push:`, `await-merge:`, `slices:` with no value,  | pass | 04.AC2.md | error text still says 'action: update' |
| 04.AC3 Given a step with two head keys (e.g. `agent:` and `check:`) or none, when the file loads, then it is refused  | pass | 04.AC3.md |  |
| 04.AC4 Given a `like` copy, when the file loads, then the copy has its target's head key, and a copy writing a differ | pass | 04.AC4.md |  |
| 04.AC5 Given an agent step with a missing or empty orientation, when the file loads, then it is refused naming the st | pass | 04.AC5.md |  |
| 04.AC6 Given an agent step with no `skills:`, when the file loads, then it loads; given one naming the same skill twi | pass | 04.AC6.md |  |
| 04.AC7 Given `by: <name>` on a step, when the workflow loads, then the step runs on that configured agent, and withou | pass | 04.AC7.md |  |
| 04.AC8 Given `outcomes:` holding `outcome: target` and `{ to, counter }`, with `means:` and `verdict:` maps beside it | pass | 04.AC8.md |  |
| 04.AC9 Given an agent step routing an outcome the agent may report with no meaning, when the file loads, then it is r | pass | 04.AC9.md |  |
| 04.AC10 Given a meaning or verdict for an outcome the step does not route, or `means:` / `verdict:` on a step that is  | pass | 04.AC10.md |  |
| 04.AC11 Given a shared file in the new wording and a workflow using it, when it loads, then its `{ exit: … }` routes l | pass | 04.AC11.md |  |
| 04.AC12 Given each shipped workflow and shared file in today's wording and its translation, when both load, then the l | pass | 04.AC12.md |  |
| 04.AC13 Given a file in today's wording, in the main checkout or a copy, when it loads, then it still loads (through t | pass | 04.AC13.md |  |
| 05.AC1 Given `norn init` in a fresh repo, when it writes the workflows and shared files, then each loads in the new w | pass | 05.AC1.md |  |
| 05.AC2 Given this repo's `.agents/workflows/` (with `shared/` and `release.yaml`), when loaded, then every file is in | pass | 05.AC2.md | shared copies equal by steps/head keys, not bytes (repo customised) |
| 05.AC3 Given the emitted schemas, when the schema emit check runs, then the workflow-source and shared-file schemas d | pass | 05.AC3.md | no file names a $schema; holds vacuously |
| 05.AC4 Each agent step's hand-written orientation tells the agent what the step is for, in the spirit of the design r | person | 05.AC4.md |  |
| 06.AC1 Given the cli integration suite, when it runs in CI, then it passes, and no test writes an old-wording workflo | unverified | 06.AC1.md | no CI run covers HEAD 3af53e1 (PR #353 head is d01b9d7, where integration shards 1, 2 and  |
| 06.AC2 Given each migrated test, when compared with before, then it asserts the same behaviour (same commands, same e | pass | 06.AC2.md | upgrade --json gained a workflows field (spec behaviour) |
| 07.AC1 Given the unit tier and the e2e tier, when they run, then they pass, and no test writes an old-wording workflo | pass | 07.AC1.md | e2e light-path flaked once (3 fail), then 5/5 twice |
| 07.AC2 Given e2e transcripts and observe snapshots, when they change, then only the fixtures' wording moved, never an | pass | 07.AC2.md |  |
| 08.AC1 Given a repo whose `.agents/workflows/` and `shared/` hold old-wording files, when `norn upgrade` runs, then e | pass | 08.AC1.md |  |
| 08.AC2 Given one file holding a comment the rewrite cannot place, when `norn upgrade` runs, then that file is left as | pass | 08.AC2.md |  |
| 08.AC3 Given `norn upgrade` already ran, when it runs again, then no workflow file changes. | pass | 08.AC3.md |  |
| 08.AC4 Given a repo whose files are all in the new wording, when `norn upgrade` runs, then it rewrites none and repor | pass | 08.AC4.md |  |
| 08.AC5 Given units with pins, receipts and state in the machine dir, when `norn upgrade` runs, then a hash of the mac | unverified | 08.AC5.md | the machine dir here had no units with pins, receipts or state (making them needs a remote |
| 09.AC1 Given a main-checkout file with any `type`, `skill`, `instructions`, `run`, `prompt` or `action` key, or `mean | pass | 09.AC1.md |  |
| 09.AC2 Given a step mixing old and new wording, when its main-checkout file loads, then it is refused as old wording  | pass | 09.AC2.md |  |
| 09.AC3 Given a repo with two old-wording workflow files, when `norn doctor` runs, then it reports one issue per file, | pass | 09.AC3.md |  |
| 09.AC4 Given an old-wording main-checkout file, when a person starts a new round from it (`norn story edit --workflow | unverified | 09.AC4.md | story edit on an existing story and intake of an old-workflow issue need a remote with sto |
| 09.AC5 Given a story in flight whose pin is in the old wording, when ticks run it to the end of its round, then the p | unverified | 09.AC5.md | driving a story on an old-wording pin to the end of its round needs a remote; the copy rea |
| 09.AC6 Given a story whose record is lost and whose branch holds an old-wording workflow file, when `norn story check | unverified | 09.AC6.md | norn story checkout with a lost record needs a remote story branch; the copy read is verba |
| 09.AC7 Given a new unit started from the main checkout, when it pins its workflow, then the pinned text is in the new | pass | 09.AC7.md |  |
| 09.AC8 Given a throwaway repo with an old-wording workflow, when a person runs `norn doctor`, follows its `do_instead | pass | 09.AC8.md |  |
| 10.AC1 Given the docs, when a reader looks for how to write a step, then the concepts page, the workflow recipes and  | pass | 10.AC1.md |  |
| 10.AC2 Given the generated reference, when the docs emit check runs in the unit tier, then it is up to date and the g | pass | 10.AC2.md |  |
