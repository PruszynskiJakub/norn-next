---
id: gh-343
slug: a-step-is-written-with-two-keys-for-one
provider: gh
number: 343
url: https://github.com/PruszynskiJakub/norn-next/issues/343
title: A step is written with two keys for one fact, and an agent step must name a skill
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:high
  - norn:wf:story
workflow: story
status: done
intake_at: 2026-11-16T15:23:54.534Z
body_hash: 7fbc55d648d29da4c82b1f01627eee670941563520c70a99287cf49a8e7474ca
refined_body_hash: 7fbc55d648d29da4c82b1f01627eee670941563520c70a99287cf49a8e7474ca
criteria:
  - { id: 01.AC1, verifier: test }
  - { id: 01.AC2, verifier: test }
  - { id: 02.AC1, verifier: test }
  - { id: 02.AC2, verifier: test }
  - { id: 02.AC3, verifier: test }
  - { id: 02.AC4, verifier: test }
  - { id: 02.AC5, verifier: test }
  - { id: 02.AC6, verifier: test }
  - { id: 03.AC1, verifier: test }
  - { id: 03.AC2, verifier: test }
  - { id: 03.AC3, verifier: test }
  - { id: 03.AC4, verifier: test }
  - { id: 03.AC5, verifier: test }
  - { id: 03.AC6, verifier: test }
  - { id: 03.AC7, verifier: test }
  - { id: 03.AC8, verifier: test }
  - { id: 03.AC9, verifier: test }
  - { id: 04.AC1, verifier: test }
  - { id: 04.AC2, verifier: test }
  - { id: 04.AC3, verifier: test }
  - { id: 04.AC4, verifier: test }
  - { id: 04.AC5, verifier: test }
  - { id: 04.AC6, verifier: test }
  - { id: 04.AC7, verifier: test }
  - { id: 04.AC8, verifier: test }
  - { id: 04.AC9, verifier: test }
  - { id: 04.AC10, verifier: test }
  - { id: 04.AC11, verifier: test }
  - { id: 04.AC12, verifier: test }
  - { id: 04.AC13, verifier: test }
  - { id: 05.AC1, verifier: test }
  - { id: 05.AC2, verifier: test }
  - { id: 05.AC3, verifier: test }
  - { id: 05.AC4, verifier: person }
  - { id: 06.AC1, verifier: test }
  - { id: 06.AC2, verifier: test }
  - { id: 07.AC1, verifier: test }
  - { id: 07.AC2, verifier: test }
  - { id: 08.AC1, verifier: test }
  - { id: 08.AC2, verifier: test }
  - { id: 08.AC3, verifier: test }
  - { id: 08.AC4, verifier: test }
  - { id: 08.AC5, verifier: test }
  - { id: 09.AC1, verifier: test }
  - { id: 09.AC2, verifier: test }
  - { id: 09.AC3, verifier: test }
  - { id: 09.AC4, verifier: test }
  - { id: 09.AC5, verifier: test }
  - { id: 09.AC6, verifier: test }
  - { id: 09.AC7, verifier: test }
  - { id: 09.AC8, verifier: agent }
  - { id: 10.AC1, verifier: agent }
  - { id: 10.AC2, verifier: test }
merge:
  pr: 353
  url: https://github.com/PruszynskiJakub/norn-next/pull/353
  head_sha: 2b42ac7ea033bdec33718f41a9a7c4174b23a429
  merge_commit_sha: bce18d34b2ce34e3ec32375c9d4bf6194d655751
  merged_by: PruszynskiJakub
  merged_at: 2026-11-16T18:02:41.000Z
---

# A step is written with two keys for one fact, and an agent step must name a skill

## Problem Statement

Whoever writes or reads a workflow, a person or an agent, meets each step saying what it is twice: `type: agent` plus `skill:`, `type: check` plus `run:`, `type: git` plus `action:`, `type: gate` plus `prompt:`. An agent step must name exactly one skill, even when a paragraph of instructions does the real steering (`triage`, `reproduce`), and the brief always tells the agent to use that skill. An agent's routes are nearly all written in the long form `{ to, counter, means, verdict }`, so where a step leads and what each outcome means to the agent share one line, and the path through a workflow is hard to read. Every later change to the workflow format (a workflow skill, derived counters) would build on this wording.

## Solution

A step opens with exactly one key that says what happens: `agent: <orientation>`, `check: <command>`, `gate: <what the person decides>`, or a built-in verb with no value (`update-branch:`, `open-pr:`, `integrate:`, `push:`, `await-merge:`, `slices:`); `use:` is unchanged. An agent step's orientation is required; the skills it uses are an optional `skills:` list. `outcomes:` holds only `outcome: target` (or `{ to, counter }`); an agent step's meanings and verdicts sit beside it in `means:` and `verdict:` maps. The key that picks which configured agent runs a step becomes `by:`.

The files in the main checkout's `.agents/workflows/` are accepted only in the new wording; `norn upgrade` rewrites them mechanically, keeping their comments and layout. Stories already in flight keep running: a pinned workflow, or a workflow file read from a story branch, in the old wording still loads. decide makes the same decisions as before.

| Today | New |
|---|---|
| `type: agent` + `instructions:` | `agent: <orientation>` |
| `skill: X` | `skills: [X]` (optional) |
| per-step `agent: <name>` | `by: <name>` |
| `type: check` + `run:` | `check: <command>` |
| `type: gate` + `prompt:` | `gate: <what the person decides>` |
| `type: git`, `action: update` | `update-branch:` |
| `type: git`, `action: open-pr` | `open-pr:` |
| `type: git`, `action: integrate` | `integrate:` |
| `type: git`, `action: push` | `push:` |
| `type: merge` | `await-merge:` |
| `type: slices` | `slices:` |
| `done: { to: X, means: "…", verdict: pass }` | `done: X` in `outcomes:`, `done: …` in `means:`, `done: pass` in `verdict:` |

## User Stories

### Writing a step

1. As a workflow author, I want an agent step written as `agent: <orientation>` with its other keys (`skills`, `inputs`, `outcomes`, `means`, `verdict`, `by`, `model`, `attended`, `deadline`, `nudges`, `retries`, `criteria`, `description`) beside it, so that the step says what happens in its first line.
2. As a workflow author, I want a check step written as `check: <command>` with `timeout`, `exits` and `outcomes` beside it, so that the command is the step's head.
3. As a workflow author, I want a gate written as `gate: <what the person decides>`, so that the decision the inbox shows is the step's head.
4. As a workflow author, I want the built-in steps written as one verb with no value (`update-branch:`, `open-pr:`, `integrate:`, `push:`, `await-merge:`, `slices:`), each taking the same outcomes as its kind does today, so that I need not know the `type`/`action` pairs.
5. As a workflow author, I want a `use:` step to stay exactly as it is written today, so that shared steps need no change.
6. As a workflow author who writes a step with two head keys (for example `agent:` and `check:`), or with none, I want norn to refuse the file at load and name the step, so that a step never means two things.
7. As a workflow author, I want a verb step that is given a value (for example `open-pr: now`) refused at load, so that a verb carries no hidden meaning.
8. As a workflow author, I want a `like` step to inherit its target's head key, and a copy that writes a different head key refused for having two head keys, so that a copy cannot quietly change what kind of step it is.

### Agent steps: orientation and skills

9. As a workflow author, I want an agent step whose orientation is missing or empty refused at load, so that every agent is told what the step is for.
10. As a workflow author, I want `skills:` optional on an agent step, so that a step steered by its orientation alone (like `triage` or `reproduce`) needs no token skill.
11. As a workflow author who names a skill that is not installed (or not visible to the agent that runs the step), I want the same `unknown_skill` refusal at load as today, for each skill in the list, so that a typo is caught before a unit starts.
12. As a workflow author who names the same skill twice in `skills:`, I want the file refused at load, so that the list stays a set.
13. As an agent doing a step with one skill, I want the brief to say "Use the `X` skill." under Your work, followed by the orientation, so that I know which craft to load and what the step is for.
14. As an agent doing a step with several skills, I want the brief to say "Use the `X` and `Y` skills." (commas for three or more) in the order the list gives them, followed by the orientation.
15. As an agent doing a step with no skills, I want the brief to name no skill and give only the orientation, so that I am never sent to a skill that does not apply.
16. As a workflow author, I want the key that picks which configured agent runs a step named `by:` (`by: codex`), taking a name from the config's agents and falling back to the config's default agent, so that it no longer clashes with `agent:` the orientation.

### Outcomes, meanings and verdicts

17. As a workflow author, I want `outcomes:` to hold `outcome: target`, or `{ to, counter }` when the route counts against a counter, so that the routes read as a plain map.
18. As a workflow author, I want an agent step's meanings in a sibling `means:` map and its verdicts in a sibling `verdict:` map, keyed by outcome, so that routing and prose are apart.
19. As an agent finishing a step, I want the brief's finish lines to show each outcome's meaning and verdict exactly as they read today, so that the move of the prose changes nothing I see.
20. As a workflow author, I want norn to refuse at load a reportable agent outcome that has a route and no meaning, naming the step and outcome, so that every outcome an agent may report has a contract.
21. As a workflow author, I want norn to refuse at load a meaning or a verdict for an outcome the step does not route, so that no stale prose is left behind.
22. As a workflow author, I want the overridable routes (`silent`, `died`, `timeout`, `stalled`, `ask`, `stuck`) to need no meaning, so that overriding where they lead stays one line.
23. As a workflow author, I want `means:` and `verdict:` refused on any step that is not an agent step, and `means`/`verdict` inside an edge refused everywhere, so that there is one place for each.
24. As a workflow author of a shared file, I want its `{ exit: … }` routes to keep working as written today, so that shared steps leave the same way.

### The old wording

25. As a person whose main checkout's `.agents/workflows/` holds a file in the old wording (any `type:` key, `skill:`, `instructions:`, `run:`, `prompt:`, `action:`, or `means`/`verdict` inside an edge), I want norn to refuse it with a message naming the old wording and a `do_instead` naming `norn upgrade`, so that I know the one command that fixes it.
26. As a person whose file mixes old and new wording in one step, I want it refused as old wording with the same `do_instead`, so that a half-edited file is not guessed at.
27. As a person running `norn doctor` on a repo with old-wording workflow files, I want one issue per such file naming `norn upgrade`, so that I see every file affected at once.
28. As a person whose main checkout's workflow files are refused, I want norn to treat them as it treats an invalid workflow today (no new round starts from them; doctor, sync and the inbox report them), so that nothing runs on a file norn cannot read.
29. As a person with a story in flight when the new norn arrives, I want its pinned workflow in the old wording to keep loading, with its text and hash on disk untouched, so that the story finishes its round without any action from me.
30. As a person reading the record or trace of a past round, I want its old-wording pin to load as before, so that history stays readable.
31. As a person restarting a story whose record is lost (`norn story checkout`), I want a workflow file read from its story branch in the old wording to load, as a pin does, so that a branch cut before the upgrade can still be restarted.
32. As a person, I want units started after the upgrade to pin their workflow in the new wording, so that new run state never holds the old one.
33. As a person, I want decide to make exactly the same decisions on a workflow whether it was written in the old or the new wording, so that the change is in the writing only.

### norn upgrade

34. As a person running `norn upgrade`, I want each file in the main checkout's `.agents/workflows/` and its shared folder in the old wording rewritten to the new wording and staged with the rest of the upgrade, so that one command and one commit move the repo over.
35. As a person, I want the rewrite to load to the same workflow as before, so that what runs does not change.
36. As a person, I want the rewrite to keep every comment, the key order, the scalar styles (block, folded, quoted) and every untouched key in place, so that my file still reads as I wrote it.
37. As a person, I want a comment on a long edge that is split into `outcomes:` / `means:` / `verdict:` kept on that outcome's line in `outcomes:`, so that it stays next to the route it explained.
38. As a person whose file holds a comment the rewrite cannot place, I want upgrade to refuse that one file, naming the file and the comment's line, and still rewrite every other file, so that I have one hand edit left and not a stuck repo.
39. As a person, I want `skill: X` rewritten as `skills: [X]`, and an agent step's `instructions` to become its orientation word for word, so that the brief says what it said before.
40. As a person whose agent step has a skill and no instructions, I want upgrade to write the step's `description` as the orientation, or, with no description, the line ``Use the `X` skill.``, so that the rewrite stays mechanical and the step loads.
41. As a person whose gate has no prompt, I want upgrade to write the gate's `description` as its text, or, with no description, `approve or reject <step>` (the text norn shows for such a gate today), so that the gate loads and reads as it does today. Old pins and branch files load with the same fallback.
42. As a person whose agent step sets `agent: <name>` to pick its agent, I want upgrade to rename it to `by: <name>`, so that the step keeps running on the same agent.
43. As a person running `norn upgrade` a second time, I want it to change no workflow file, so that it is safe to repeat.
44. As a person with a workflow written in JSON, I want the rewrite to keep it JSON, so that my tooling still reads it.
45. As a person, I want `norn upgrade` never to touch anything under the machine dir's run state, so that pins, receipts and their hashes stay immutable.
46. As a person whose files are all in the new wording already, I want `norn upgrade` to rewrite none of them and report no workflow change.

### Shipped workflows and docs

47. As a person running `norn init`, I want the shipped workflows and shared files written in the new wording, each agent step with a hand-written orientation (as in the design record's `quick.yaml`), so that a new repo starts in the current wording.
48. As a contributor to this repo, I want this repo's workflow copies, including `release.yaml` (which has no shipped copy), written in the new wording with hand-written orientations, so that norn runs on its own wording.
49. As a workflow author, I want the emitted JSON Schema to describe the new wording only, so that my editor completes and checks the keys I write.
50. As a reader of the docs, I want the concepts page, the recipes (including writing your own workflow and naming your own skill in a step), and the generated reference to show the new wording, so that nothing teaches the old one.

## Out of Scope

- Counters and derived bounds — a separate issue.
- Shared steps — already shipped; `use:` is unchanged here.
- Gates' new keys (what a gate judges, whether it may be delegated) — a separate issue; only the gate's text moves here.
- Hand-backs (files a step must hand back) — a separate issue.
- Simplifying the base update's light path — a workflow edit of its own, recorded in the design record.
- Rewriting pins or any other run state — run state is immutable; old pins load through the translation instead.

## Further Notes

- Design record: https://gist.github.com/PruszynskiJakub/0dcf9042145fe9c46f32bd9b8b94fb19 (`quick.yaml` shows the wording). Related: #341 (a workflow skill), #342 (shared steps).
- The name `by:` is a decision the owner may still rename before the build. `runner:` was rejected: in norn a runner is already the terminal runner (Herdr or headless), and an old `runner` config key is still refused.
- The value decide reads changes in one place only: an agent step's single skill becomes a list, and the check that tells a re-refined story reads "the step's skills include the refine skill". The golden cases' embedded workflows are rewritten to the new shape; their decisions do not change.
- The old-wording refusal applies only to the main checkout's `.agents/workflows/` (what doctor, sync, a new round and upgrade read). Pins and files read from a story branch are copies from before the upgrade and load through the same translation `norn upgrade` uses.
- Changing how norn reads workflows is a new minor, which by the repo's version rule needs `norn upgrade` and a commit.

## Plan

### Seams
- **S1 store workflow loading, through `loadWorkflows` / `loadWorkflow` (the main checkout's files) and `loadWorkflowText` / `readPinnedWorkflow` (copies: pins, files read from a story branch).** Observes every step shape accepted or refused at load (head keys, verbs, `like`, orientation, `skills` as a set, `by`, `outcomes` / `means` / `verdict`, shared `{ exit }` routes), the old wording refused in the main checkout but loaded from a copy, and new units pinning the new wording.
  Prior art: store `shared-workflows.test.ts` (a throwaway repo of workflow files through `loadWorkflow`), store `config-trace.test.ts`, cli `light-route.test.ts` (`parseWorkflowText` on text).
- **S2 core `validateWorkflowDefinition`, given the installed and per-agent visible skills.** Observes `unknown_skill` for each skill in the list, per agent picked by `by:`.
  Prior art: core `workflow.test.ts`.
- **S3 core brief, through the brief builder and its markdown render.** Observes the Your work line for zero, one and several skills followed by the orientation, and the finish lines with meanings and verdicts unchanged.
  Prior art: core `brief.test.ts` and its snapshots.
- **S4 core decide, through the golden cases.** Observes that decide decides the same on the rewritten workflows, including the re-refined-story check reading the skills list.
  Prior art: core `golden.test.ts`, repo `golden.test.ts`.
- **S5 store wording translator, through one function: workflow or shared-file text in, the new-wording text out, or a refusal naming the file and line.** Observes the mechanical, lossless rewrite (same loaded workflow, comments, key order, scalar styles, comment on a split edge, the orientation / gate / meaning fallbacks, `agent` → `by`, idempotence, JSON stays JSON, new-wording text unchanged).
  Prior art: none for the translator; the cases follow store `shared-workflows.test.ts`'s text-fixture style.
- **S6 `norn upgrade`, through the cli harness.** Observes old files in `.agents/workflows/` and `shared/` rewritten and staged, one file refused for an unplaceable comment while the others are rewritten, a second run changing nothing, run state untouched, an all-new repo reporting no workflow change.
  Prior art: cli integration `upgrade.test.ts`, `upgrade-version.test.ts`.
- **S7 the old wording at the cli, through the cli harness (`norn doctor`, `norn sync`, a new round with `norn story edit --workflow`, `norn story checkout` of a lost record).** Observes the refusal with `do_instead` naming `norn upgrade`, one doctor issue per old file, a refused file treated as an invalid workflow, a story in flight finishing on its old pin, and a restart from an old branch file.
  Prior art: cli integration `shared-workflows.test.ts` (doctor over workflow files), `takeover-record-lost.test.ts`.
- **S8 the shipped files, through `assets.test.ts`.** Observes the shipped workflows and shared files and this repo's copies (with `release.yaml`) loading in the new wording with orientations, and the emitted schema matching the sources.
  Prior art: cli `assets.test.ts`, the schema emit check.

### Coverage
| User story | Seam | Test kind | Notes |
|---|---|---|---|
| 1 agent step written as `agent: <orientation>` with its keys beside it | S1 | unit | |
| 2 check step written as `check: <command>` | S1 | unit | |
| 3 gate written as `gate: <decision>` | S1 | unit | loaded `prompt` = gate text |
| 4 built-in steps as one value-less verb, same outcomes | S1 | unit | one case per verb, incl. `clean`/`resolved` only on `update-branch` |
| 5 `use:` unchanged | S1 | unit | existing shared-workflow cases stay green |
| 6 two head keys or none refused, naming the step | S1 | unit | |
| 7 a verb with a value refused | S1 | unit | |
| 8 `like` inherits the head key; a different one refused as two | S1 | unit | |
| 9 missing or empty orientation refused | S1 | unit | |
| 10 `skills:` optional | S1 | unit | |
| 11 `unknown_skill` per skill in the list | S2 | unit | installed and per-agent visibility |
| 12 a skill named twice refused | S1 | unit | |
| 13 brief: "Use the `X` skill." then the orientation | S3 | unit | snapshot |
| 14 brief: "Use the `X` and `Y` skills." in list order, commas for three+ | S3 | unit | |
| 15 brief: no skill line, only the orientation | S3 | unit | |
| 16 `by:` picks the configured agent, default fallback | S1 | unit | S2 covers `by:` picking the agent whose skills are checked |
| 17 `outcomes:` holds `target` or `{ to, counter }` | S1 | unit | |
| 18 sibling `means:` / `verdict:` maps | S1 | unit | loaded onto the edges |
| 19 finish lines read as today | S3 | unit | snapshots unchanged |
| 20 routed reportable outcome without meaning refused | S1 | unit | |
| 21 meaning or verdict for an unrouted outcome refused | S1 | unit | |
| 22 overridable routes need no meaning | S1 | unit | |
| 23 `means`/`verdict` off agent steps and inside edges refused | S1 | unit | edge case is old wording in the main checkout (25) |
| 24 shared `{ exit }` routes work as today | S1 | unit | means from the shared file's `means:` map |
| 25 old wording refused, `do_instead` names `norn upgrade` | S1 | unit | S7 checks the CliError end to end |
| 26 mixed wording refused as old | S1 | unit | |
| 27 doctor: one issue per old file | S7 | integration | |
| 28 old files treated as an invalid workflow | S7 | integration | no new round; sync and doctor report |
| 29 old pin keeps loading, text and hash untouched | S1 | unit | S7 runs a story in flight to its end |
| 30 old pin of a past round readable | S1 | unit | trace reader and record reader use the copy read |
| 31 old branch file loads at a lost-record restart | S7 | integration | pinned verbatim (D4) |
| 32 new units pin the new wording | S1 | unit | |
| 33 decide decides the same in either wording | S4 | unit | golden cases byte-identical; S1 checks old and new text load to equal workflows |
| 34 upgrade rewrites and stages workflow and shared files | S6 | integration | |
| 35 rewrite loads to the same workflow | S5 | unit | compare loaded workflows |
| 36 comments, key order, scalar styles kept | S5 | unit | |
| 37 comment on a split edge stays on its outcome line | S5 | unit | |
| 38 unplaceable comment refuses that file only, naming the line | S5 | unit | S6 checks the other files still rewritten |
| 39 `skill` → `skills: [X]`, instructions word for word | S5 | unit | |
| 40 orientation fallback: description, then "Use the `X` skill." | S5 | unit | |
| 41 gate fallback: description, then `approve or reject <step>` | S5 | unit | amended in plan |
| 42 per-step `agent: <name>` → `by: <name>` | S5 | unit | |
| 43 second run changes nothing | S5 | unit | S6 also |
| 44 JSON stays JSON | S5 | unit | |
| 45 run state untouched | S6 | integration | hash the machine dir before and after |
| 46 all-new files: no workflow change reported | S6 | integration | |
| 47 shipped workflows in the new wording with orientations | S8 | unit | orientations reviewed by a person |
| 48 this repo's copies (with `release.yaml`) in the new wording | S8 | unit | |
| 49 emitted JSON Schema describes the new wording only | S8 | unit | emit check; review |
| 50 docs show the new wording | — | review | docs lint for the glossary; review and `bun run docs:emit` |

### Prefactoring
1. Tell the two workflow reads apart: the readers of the main checkout (`loadWorkflows`, `loadWorkflow`) and the readers of a copy (`readPinnedWorkflow`, `pinWorkflow`, the tick-trace reader, the record reader's branch read, the lost-record restart) pass an explicit read kind through `loadWorkflowText` / `parseWorkflowText`; both behave the same until the format changes. Makes 25–32 a change in one place.
2. The loaded model's `skill: string` becomes `skills: string[]` (optional), with the parser mapping today's `skill: X` to `[X]`; brief, the re-refined-story check, the skill validation and the golden cases' embedded workflows move with it. Lands the only change decide sees before the format moves, so 10–15 and 33 are proven on their own.

### Implementation decisions
- D1 **The loaded model stays the `type`-tagged union** (owner's choice). The file format changes; the loader normalises the new wording into the model, so core, view and cli keep reading `step.type`, `step.run`, `step.prompt`, `step.action`, and edges keep `means` / `verdict`. Model changes: `skills?: string[]` (D2 prefactor), `instructions` required and non-empty (the orientation), gate `prompt` required (the gate text), per-step agent name kept as the model's `agent` field. Beat: a model in the new wording, which would touch about 60 readers.
- D2 **The load pipeline**, per file text: YAML document → wording check (new / old / mixed, mixed counts as old) → for a copy read only, the old→new translator (D3) on the workflow and each shared file it uses → new-wording checks (head keys, verbs, `means`/`verdict` placement, before schema validation so the union's noise never reaches the person) → `like`/`use` flattening, unchanged, on new-wording documents (an exit route takes `to`/`counter` from the use step; meanings come from the shared file's `means:` map) → normalise to the model → model schema and `validateWorkflowDefinition`. A unit pins the flattened new-wording text (or the text as written when it has no `use`/`like`, as today).
- D3 **One old→new translator in store over the `yaml` Document**, used by `norn upgrade` (writes `toString`) and by copy reads (reads `toJS`), so both always agree. It renames in place to keep key order: `type` + `instructions` → `agent:` (orientation in `instructions`' node and style), `skill` → `skills: [X]` (flow, no padding), `agent: <name>` → `by:`, `type: check` + `run` → `check:`, `type: gate` + `prompt` → `gate:`, `type: git`/`merge`/`slices` → the value-less verb. Each long edge keeps `to`/`counter` in `outcomes:`; `means`/`verdict` move into sibling maps written right after `outcomes:`. Fallbacks: orientation = instructions, else description, else ``Use the `X` skill.``; gate text = prompt, else description, else `approve or reject <step>` (owner's choice, story 41 amended); a routed reportable outcome without a meaning gets `step finished with outcome <o>`, today's brief fallback (owner's choice), so story 20 holds and the brief reads the same. A comment moves with its node or onto the node that replaces it (a split edge's trailing comment onto the outcome's line); a comment left with no node to sit on refuses the file, naming the file and the comment's line. A text that parses as JSON is written back as JSON with two-space indent and its key order.
- D3a **Byte for byte outside what changes** (owner's addition). The rewrite never re-wraps a folded or block scalar it does not change and never pads a flow list (`[X]`, not `[ X ]`); every untouched key keeps its text byte for byte, and a moved scalar (an orientation, a meaning) keeps its text as written. Where the library cannot keep a scalar as written, that file is refused like an unplaceable comment, naming the file and line, never silently reflowed. Tests compare the output text byte for byte, with folded and block scalars, long lines and flow lists in the fixtures.
- D4 **A lost-record restart pins the branch file's text verbatim** (owner's choice); it loads through D3 like an old pin, and its hash matches the branch file. Story 32 covers units started from the main checkout.
- D5 **Old-wording detection**: a step with any `type`, `skill`, `instructions`, `run`, `prompt` or `action` key, or `means`/`verdict` inside an edge or an exit route. A main-checkout file found in the old wording is one file error (`old_wording`) naming the steps and keys, so doctor reports one issue per file; every command that refuses an invalid workflow puts `norn upgrade` in `do_instead` for it.
- D6 **Head keys**: `agent`, `check`, `gate`, `update-branch`, `open-pr`, `integrate`, `push`, `await-merge`, `slices`; `use` and `like` keep their own handling. A verb's value must be YAML null. `means:` and `verdict:` exist on agent steps only.
- D7 **Schemas**: the emitted `workflow-source` and `workflow-shared` schemas describe the new wording only, one step schema per head key; the model schema stays registered for validating the loaded workflow and Facts but is no longer published as `workflow.schema.json`. Shipped files keep whatever `$schema` reference they use, pointed at the new-wording schema.
- D8 **Golden cases** are rewritten once with the model change (skill → skills, required orientation and gate text filled with the D3 fallbacks); every decision stays byte-identical. A diff in a decision is a bug, not a re-record.
- D9 **`norn upgrade`** rewrites the workflow files after its other checks pass and before `norn_version`, staged with the rest. The report gains `workflows: { rewritten, refused }` (each refusal: file, line, message), shown in markdown too. A file D3 refuses is listed, not fatal: the other files are still rewritten, `norn_version` is still written, the exit code stays 0 (like the labels report), and doctor keeps reporting that file until the hand edit. Beat: refusing the whole run, which would leave one stray comment blocking the repo (story 38).

### Testing decisions
A good test here writes workflow text the way a person would and checks what norn accepts, refuses (the message and path naming the step) or loads, never the translator's or normaliser's internals. Equality of loaded workflows (old text vs its upgrade, new text vs today's model) proves "same workflow". Lossless rewrite is checked on the text out, byte for byte against the expected file. The store loading and translator tests are unit tests on throwaway files; the cli tests use the harness in a repo under `$TMPDIR`. Faked: only the agents' installed-skill folders (S2's skill lists) and the remote in the cli harness. Golden cases and brief snapshots change only for the D8 fixture rewrite and the new skill lines; their decisions and finish lines must not move.

### Risks
- The lossless rewrite is the part most likely to go wrong. A spike on the `yaml` Document API (renaming a key in place, replacing `type` with the head key in its position, splitting a flow edge into `outcomes` / `means` / `verdict`, keeping its trailing comment and a folded scalar's style) worked; it showed flow sequences padded by default (`[ X ]`) and a folded scalar re-wrapped (style kept, line breaks not), both of which D3a forbids: padding has an option, keeping a scalar's source text (e.g. splicing the original source range for untouched and moved scalars, or `lineWidth: 0`) is not yet proven. Slices should meet the translator early, against every shipped workflow in the old wording as a fixture.
- Copy reads must translate every old file in a branch read, shared files included; a missed reader (trace, record, checkout) leaves a past round unreadable. Prefactor 1 names them all.
- `assets.test.ts` pins `workflowHash` of the loaded workflows; the model change and new orientations move those hashes on purpose, to be reviewed, not re-recorded blindly.
- `like` copies merge shallowly: a copy writing `means:` replaces the whole map, which may then miss a meaning for an inherited route and be refused (story 20). That is the intended rule; the docs should say it.
