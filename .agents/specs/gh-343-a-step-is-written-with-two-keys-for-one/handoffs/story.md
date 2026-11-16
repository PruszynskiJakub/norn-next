# gh-343 handoff

## Goal

A step opens with one head key; skills become an optional `skills:` list; meanings and verdicts move to sibling `means:` / `verdict:` maps; `by:` picks the agent. `norn upgrade` rewrites old files losslessly, and old pins keep loading. All 10 slices are integrated and QA #1 is done. Review #1's two blocking findings are fixed.

## Proof

QA #1 report: 47 pass, 0 fail. Golden decisions are identical to origin/main in all 139 cases. Unit tier and typecheck are green at 43d704d. Paths: store = `packages/store/test/unit/`, cli = `packages/cli/test/`.

| Criterion | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| 01.AC1 | every reader loads today's file the same | test | store `workflow-reads.test.ts`; cli `integration/takeover-record-lost.test.ts` (CI pending) |
| 01.AC2 | each reader names its read kind | test | store `workflow-reads.test.ts` |
| 02.AC1 | one skill: "Use the `X` skill." | test | core `brief.test.ts` › "Your work names the step's skills…" |
| 02.AC2 | two or three skills, in order | test | same test.each |
| 02.AC3 | no skills: instructions only | test | same test.each |
| 02.AC4 | `unknown_skill` per missing skill | test | core `workflow.test.ts` › "each skill in a step's list is checked…" |
| 02.AC5 | refine step found by its skills | test | core `decide.test.ts` › "GR8: a refine step is the one whose skills include…" |
| 02.AC6 | golden decisions and finish lines unchanged | test | `golden.test.ts` |
| 03.AC1 | shipped files translate byte for byte | test | store `wording` › "<f> translates byte for byte…" |
| 03.AC2 | scalars kept, or the file refused with its line | test | `wording` › "folded, block and quoted scalars…" |
| 03.AC3 | skill + instructions → `agent:` + `skills:` | test | `wording` › "an agent step's skill and instructions…" |
| 03.AC4 | fallback texts | test | `wording` › "fallbacks" |
| 03.AC5 | long edge split, comment kept | test | `wording` › "a long edge keeps to/counter…" |
| 03.AC6 | `agent: <name>` → `by:` | test | `wording` › "a step's `agent: <name>` becomes `by:`" |
| 03.AC7 | orphaned comment refuses the file | test | `wording` › "a comment left with no line to sit on…" |
| 03.AC8 | translating twice changes nothing | test | `wording` › "…translates to itself" |
| 03.AC9 | JSON stays JSON | test | `wording` › "a JSON workflow is written back as JSON…" |
| 04.AC1 | head keys load to the same model | test | store `new-wording` › "agent, check and gate steps load…" |
| 04.AC2 | value-less verbs; a verb with a value is refused | test | `new-wording` › "`%s:` with no value…", "a verb given a value…" |
| 04.AC3 | two head keys or none refused | test | `new-wording` › "a step with two head keys, or none…" |
| 04.AC4 | `like` inherits the head key | test | `new-wording` › "a like copy has its target's head key…" |
| 04.AC5 | empty orientation refused | test | `new-wording` › "an orientation that is missing or empty…" |
| 04.AC6 | `skills` optional, no duplicates | test | `new-wording` › "skills are optional and a set…" |
| 04.AC7 | `by:` picks the agent | test | `new-wording` › "`by:` picks the configured agent…" |
| 04.AC8 | sibling means/verdict land on edges | test | `new-wording` › "each route carries the meaning and verdict…" |
| 04.AC9 | reportable outcome needs a meaning | test | `new-wording` › "a routed outcome the agent may report with no meaning…" |
| 04.AC10 | stale or misplaced meaning refused | test | `new-wording` › "a meaning or verdict for an outcome the step does not route…" |
| 04.AC11 | shared exit routes keep working | test | `new-wording` › "a shared file's exits leave through the use step's routes…" |
| 04.AC12 | shipped file and its translation load equal | test | `new-wording` › "each shipped workflow and shared file, read as a copy…" |
| 04.AC13 | old wording loads as a copy | test | `new-wording` › "a file in today's wording loads as a copy…" |
| 05.AC1 | init writes new wording with orientations | test | cli `unit/assets.test.ts` › "norn init writes every workflow…" |
| 05.AC2 | repo copies are new wording | test | `assets.test.ts` › "this repo's workflows…", "this repo's shared copies…" |
| 05.AC3 | schemas: one shape per head key | test | schema `workflow.test.ts`; `ids-config.test.ts` |
| 05.AC4 | orientations steer well | person | QA (person): human-qa approved |
| 06.AC1 | cli integration suite passes | test | the suite in CI, not yet green on this head |
| 06.AC2 | migrated tests assert the same | test | diff review: only wording changed |
| 07.AC1 | unit and e2e tiers pass | test | CI on d01b9d7; unit green locally at 43d704d |
| 07.AC2 | transcripts change only in wording | test | e2e transcript tests (normalised diff in handoff 07) |
| 08.AC1 | upgrade rewrites, stages, reports | test | cli `integration/upgrade-wording.test.ts` › "each old file is rewritten…" |
| 08.AC2 | one refused file, the rest rewritten, exit 0 | test | `upgrade-wording` › "that file is left as written and listed…" |
| 08.AC3 | a second run changes nothing | test | `upgrade-wording` › "a second run changes no workflow file…" |
| 08.AC4 | an all-new repo is untouched | test | `upgrade-wording` › "a repo whose files are all in the new wording…" |
| 08.AC5 | run state hash unchanged | test | `upgrade-wording` › "units with pins, receipts and state…" |
| 09.AC1 | old keys refused, `do_instead` names upgrade | test | store `old-wording-refusal.test.ts`; cli `integration/old-wording.test.ts` |
| 09.AC2 | a mixed step is refused as old | test | `old-wording-refusal.test.ts` › "a step mixing both wordings…" |
| 09.AC3 | doctor: one issue per old file | test | `old-wording` › "doctor reports one issue per old file…" |
| 09.AC4 | no round from an old file; inbox names it | test | `old-wording` › "a tick starts no story on an old file…" |
| 09.AC5 | old pin in flight finishes untouched | test | `old-wording` › "the pin loads, its text and hash stay…" |
| 09.AC6 | lost-record restart pins the old branch file | test | `takeover-record-lost.test.ts` › "an old-wording workflow file on the branch…" |
| 09.AC7 | new unit pins new wording, flattened | test | `old-wording` › "a workflow using a shared file is pinned flattened…" |
| 09.AC8 | doctor → upgrade → doctor is clean | agent | QA (agent): QA #1 |
| 10.AC1 | docs teach the new wording | agent | QA (agent): QA #1 |
| 10.AC2 | reference current, glossary lint | test | cli `unit/reference.test.ts`; `test/repo/repo.test.ts` |

## Easy to miss

- The loaded model stays the `type`-tagged union. Only the file format changed.
- Old-wording fixtures that are *about* old wording (pins, branch files, upgrade input) stay old on purpose.
- The workflow hash moves whenever a workflow's text moves; decisions must not.

## Not proven yet

- 06.AC1, 07.AC1, 01.AC1: integration CI has not yet run green on this head.
- Review #1's minor and nit findings are left as notes in the review receipt, as the brief asked.

## Notes

- Review #1 F1 (an old copy with a blank instructions or prompt loaded as corrupt) is fixed in `packages/store/src/wording.ts`. A blank `instructions`, `prompt` or `description` counts as missing on both paths and falls back to today's text. A `like` copy's blank override is dropped. Tests: store `new-wording.test.ts` › "blank %s loads with today's fallback text"; `wording.test.ts` › "a blank instructions or prompt takes today's fallback text".
- Review #1 F2 (upgrade could stage broken YAML) is fixed. `translateYaml` re-parses its splice and requires it to deep-equal `translateWordingValue`; otherwise it refuses at the step that differs. Flow-edge prose is removed one run at a time, so removals never overlap. A multi-line `skill:` is refused. Tests: `wording.test.ts` › "a flow edge with uneven spacing…", "a skill written as a block scalar is refused…", "a rewrite that would load differently… is refused at its step".
- That check now refuses minor #3's input (a `like` copy that repeats `type: agent`). It does not translate it.

## Resume

Review this head for review #1's F1 and F2. CI must go green on it.
