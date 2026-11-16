# gh-343 handoff

## Goal

A step opens with one head key; skills become an optional `skills:` list; meanings and verdicts move to sibling `means:` / `verdict:` maps; `by:` picks the agent. `norn upgrade` rewrites old files losslessly, and old pins keep loading. All 10 slices are integrated, review #2 approved, and QA #2 ran on 3af53e1.

## Proof

QA #2 (on 3af53e1): 46 pass, 1 person, 6 unverified, 0 fail. The pass and person verdicts were observed through the dev CLI in throwaway repos (init, doctor, story create refusal, upgrade) and through the store/core entry points; the run's evidence holds the files. Golden decisions are identical to origin/main in all 139 cases. Unit tier (2067 pass) and typecheck are green at 8e65cf1 (review #2). Paths: store = `packages/store/test/unit/`, cli = `packages/cli/test/`.

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
| 03.AC2 | scalars kept, or the file refused with its line | test | `wording` › "folded, block and quoted scalars…", "a skill written as a block scalar is refused…", "a rewrite that would load differently… is refused at its step" |
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

Each of these needs a remote with stories, or CI on a pushed head:
- 06.AC1 the cli integration suite in CI. PR #353's last CI ran at d01b9d7, where 3 of 4 integration shards were red; this head has not been pushed.
- 01.AC1 today's file loads the same through trace, record and restart: the integration tests are not run on this head.
- 08.AC5 the run-state hash with real units: observed only on a machine dir with no units.
- 09.AC4 story edit / intake from an old file; the inbox names it.
- 09.AC5 an old pin driven to the end of its round.
- 09.AC6 the lost-record restart pinning the old branch file: a copy read keeps the bytes and hash (library), but `norn story checkout` was not driven.
- 05.AC4 the orientations are the person's call. The workflow text is unchanged since human-qa#1 approved it at ebc79fa.

## Notes

- Review #2 approved: review #1's blocking F1 (an old copy with a blank instructions/prompt loaded as corrupt) and F2 (upgrade could stage broken YAML) are fixed; both repros now load or are refused, never written broken. `translateYaml` checks its splice against `translateWordingValue` and refuses the step that differs.
- Review #1's minor and nit findings stay as notes for the person (review #1 receipt); only the `apply` comment nit is fixed.
- QA #2: the e2e tier flaked once locally (light-path.test.ts › "light path after a base update": 3 fail after a harness `git clone` "failed to copy file"), then passed 5/5 twice. Watch the CI e2e shards.
- QA #2 nits for the person: core's message for a wrong outcome on a verb still uses old words ("…base update only (action: update), not of action: open-pr"); the upgrade's commit hint reads "Refresh norn's skills (norn upgrade)" when only workflows were rewritten.
- Merge danger for the PR: `norn brief --json` renames `work.skill` to `work.skills`.

## Resume

CI must go green on this head (integration and e2e tiers) before ready is approved.
