---
id: gh-342
slug: workflows-cannot-share-steps-so-the-same
provider: gh
number: 342
url: https://github.com/PruszynskiJakub/norn-next/issues/342
title: Workflows cannot share steps, so the same steps are copied into quick, story and release
assignee: PruszynskiJakub
labels:
  - norn
  - norn:kind:feature
  - norn:priority:medium
  - norn:risk:high
  - norn:wf:story
workflow: story
status: active
intake_at: 2026-11-16T13:07:56.445Z
body_hash: 051566a83f8f299b5c04600b803b4dd57821f8234a3a399096d9f6ec5e729496
refined_body_hash: 051566a83f8f299b5c04600b803b4dd57821f8234a3a399096d9f6ec5e729496
criteria:
  - { id: "01.AC1", verifier: test }
  - { id: "01.AC2", verifier: test }
  - { id: "02.AC1", verifier: test }
  - { id: "02.AC2", verifier: test }
  - { id: "03.AC1", verifier: test }
  - { id: "03.AC2", verifier: test }
  - { id: "03.AC3", verifier: test }
  - { id: "03.AC4", verifier: test }
  - { id: "03.AC5", verifier: test }
  - { id: "03.AC6", verifier: test }
  - { id: "03.AC7", verifier: test }
  - { id: "03.AC8", verifier: test }
  - { id: "03.AC9", verifier: test }
  - { id: "03.AC10", verifier: test }
  - { id: "04.AC1", verifier: test }
  - { id: "04.AC2", verifier: test }
  - { id: "04.AC3", verifier: test }
  - { id: "04.AC4", verifier: test }
  - { id: "05.AC1", verifier: test }
  - { id: "05.AC2", verifier: test }
  - { id: "05.AC3", verifier: test }
  - { id: "05.AC4", verifier: test }
  - { id: "06.AC1", verifier: test }
  - { id: "06.AC2", verifier: test }
  - { id: "07.AC1", verifier: test }
  - { id: "07.AC2", verifier: test }
  - { id: "07.AC3", verifier: test }
  - { id: "07.AC4", verifier: test }
  - { id: "07.AC5", verifier: test }
  - { id: "08.AC1", verifier: agent }
---

# Workflows cannot share steps, so the same steps are copied into quick, story and release

## Problem Statement

Whoever edits norn's workflows has to make one behaviour change in several files. That includes a norn maintainer changing the bundled workflows and a repo owner tuning the copies `norn init` wrote, or a workflow they made by copying `story` as "Write your own workflow" tells them to. A workflow file must hold every step it uses, so the sync, the base update, the CI wait and the shipping steps are written out again in `quick`, `story` and `release`. Within one file, the test check is written three times with only its next steps changed.

Today 13 of `quick`'s 15 steps match the same-named step in `story`, 10 of them down to their routes. The 30-line CI wait is inline in three workflows. Three recent changes (the ci check on a conflicting PR, the ci check pointing to failures, the base move and the light path) each had to edit five workflow files to change one behaviour. A copy that gets missed leaves workflows that silently behave differently.

## Solution

A workflow can bring in steps from a shared file, and a step can copy another step in the same file. norn flattens both when it loads the workflow, so a fix to the CI wait, the base update or the shipping steps is made in one place.

- Shared files live in a `shared/` folder next to the workflows (`.agents/workflows/shared/<name>.yaml`). A shared file holds an entry step (`start`), its `steps` and an optional `description`. It is never a workflow: it is not listed, gets no label and cannot be started.
- A step written `use: <name>` brings in `shared/<name>.yaml`. The included steps keep their own names, so any route, `base.step` or `base.verify` can name one directly. A route to the `use` step enters the shared file at its `start`.
- A shared file leaves through named exits: a route inside it says `{ exit: <name> }`, and the `use` step routes each exit like an outcome, counters included. An exit the `use` step does not route goes to `$stuck`.
- A step written `like: <step>` copies a step in the same file and replaces only what it writes itself.
- The loaded workflow is the same flat set of steps, routes and counters as today. Validation, decide, receipts and the golden cases see no shared files. A unit pins the flattened workflow.
- Both the bundled workflows and this repo's own workflows are rewritten with shared files. The difference between the two sets (test command, CI wait, instructions) collects in each set's shared files.

## User Stories

1. As a workflow author, I want a step written `use: base-update` to bring in every step of `.agents/workflows/shared/base-update.yaml`, so that the base update is written once and used by several workflows.
2. As a workflow author, I want the included steps to keep the names they have in the shared file (`update`, `resolve`, `test`), so that step names in the brief, receipts, `norn story edit --at <step>` and history read the same as before.
3. As a workflow author, I want any route, `base.step` or `base.verify` in the workflow to name an included step directly (`review.approve → test`), so that a workflow can enter a shared file in the middle.
4. As a workflow author, I want a route that names the `use` step to enter the shared file at its `start` step, so that the usual way in needs no knowledge of the file's inner steps.
5. As a workflow author, I want a route inside a shared file to leave through a named exit (`pass: { exit: tested }`) and the `use` step to route that exit like an outcome (`outcomes: { tested: qa }`), so that each workflow decides where the shared steps lead.
6. As a workflow author, I want the `use` step's route for an exit to take a counter (`broken: { to: implement, counter: test_loop }`), so that loop budgets stay in the workflow.
7. As a workflow author, I want an exit the `use` step does not route to go to `$stuck`, as an undeclared outcome does today, so that a forgotten route stops the story instead of guessing.
8. As a workflow author, I want a route inside a shared file to go straight to `$done` or `$stuck`, so that shared steps can end or stop a story without an exit.
9. As a workflow author, I want a route inside a shared file to name a counter that the including workflow declares, so that the shared steps' loops are bounded by the workflow's budgets.
10. As a workflow author, I want the workflow's `defaults:` (deadline, nudges, retries) to apply to included steps as to its own steps, so that included steps behave like steps written in place.
11. As a workflow author, I want a step written `like: test` to copy everything from the `test` step in the same file and replace only the keys it writes (such as its `outcomes`), so that `test`, `test-merge` and `test-resolution` share their command and timeout in one place.
12. As a workflow author, I want `like:` to work in a workflow and in a shared file alike, so that shared files can avoid copies too.
13. As a workflow author whose `like:` names a step that does not exist, names itself, names another `like` step, names a `use` step, or names a step in another file, I want the workflow refused when it loads with that reason, so that I fix the copy instead of getting a guess.
14. As a workflow author whose `use:` names a shared file that does not exist, I want the workflow refused when it loads, with a message naming the missing file and the folder it looked in (`.agents/workflows/shared/`), so that I can see which name is wrong.
15. As a workflow author whose included step has the same name as a workflow step or a step from another shared file, or who uses the same shared file twice, I want the workflow refused when it loads, with a message naming the clashing step and both places it comes from, so that I can rename one.
16. As a workflow author who routes an exit the shared file does not have, I want the workflow refused when it loads, naming the exit and the shared file, so that a misspelt exit is caught.
17. As a workflow author who writes `use:` inside a shared file, I want it refused when the workflow loads, with a message saying a shared file cannot use another shared file, so that shared files stay one level deep and a file can never include itself.
18. As a workflow author whose shared file has a key it may not hold (`name`, `counters`, `defaults`, `mode`, `base`), I want it refused with a message saying that key belongs in the workflow, so that I know where to move it.
19. As a workflow author whose included step breaks a validation rule (an unknown counter, a route back without a counter, a missing step), I want the message to name the shared file and the step in it, not only the step's place in the flattened workflow, so that I can find the line to fix.
20. As a person, I want a workflow refused for a shared-file reason to show up wherever a broken workflow shows up today (`norn doctor`, the workflow listing, `norn story create` and `norn story edit --workflow` refusing it), so that I meet the error before a round starts.
21. As a person, I want a file in `.agents/workflows/shared/` never listed as a workflow, never given a `norn:wf:<name>` label by `norn upgrade` or intake, and refused by `norn story edit --workflow <name>`, so that a shared file cannot be started as a round.
22. As a person, I want a unit to pin the flattened workflow (every `use` and `like` already filled in) as one file, with the fingerprint taken over that file, so that editing a shared file never changes a round that is already running.
23. As a person with units already running, I want a workflow that uses neither `use` nor `like` to be pinned byte for byte as today, with the same fingerprint, so that running units and recorded receipts are untouched when this ships.
24. As a person, I want a shared file edited while a round runs to take effect from the next round, as an edited workflow does today, so that shared files follow the rules I already know.
25. As a norn maintainer, I want the bundled `quick` and `story` rewritten with shared files to load to exactly the steps, routes and counters they have today (29 routes and 8 counters; 42 routes and 10 counters), so that the rewrite changes nothing about how a story runs, and the golden cases stay as they are.
26. As a norn maintainer, I want this repo's `quick`, `story` and `release` rewritten with this repo's own shared files, loading to the same steps, routes and counters as today, so that a fix to this repo's CI wait or base update is made in one file.
27. As a repo owner running `norn init`, I want the bundled `shared/` folder copied next to the workflows, keeping any shared file I already have, as it does for workflow files today, so that the bundled workflows load in a new repo.
28. As a workflow author, I want a JSON Schema for shared files emitted next to the workflow schema, so that my editor completes and checks a shared file as it does a workflow.
29. As a workflow author, I want "Write your own workflow" in the recipes to show a shared file, `use:`, exits and `like:`, and say what is refused, so that I can write a workflow that uses them without reading the code.

## Out of Scope

- Counters, the light path's behaviour and step wording: the rewrite must load to the same workflows, not change them.
- Anything that changes how a unit runs: shared files are flattened away before validation and decide.
- Using one shared file twice in one workflow (prefixed step names): it would change step names that receipts, goldens and `--at` rely on, and no workflow needs it today.
- A shared file using another shared file: not needed by the three shared files today; it can be allowed later without breaking anything.
- `like:` across files: a copy names a step in its own file only.
- Migrating units already running: their pins stay valid as they are.
- A skill for writing workflows (#341): it follows this story and would teach the format.
- Comments in shared files surviving into the pin: the pin is the flattened workflow.

## Further Notes

- A throwaway prototype in another notation, written before this round, showed that `quick` and `story` written with three shared files (`sync`, `base-update`, `ship`) flatten to the same routes and counter budgets as today's files.
- Repro of the duplication on `main` (`e419d33bd`): `grep -c "gh run watch" .agents/workflows/*.yaml` (1 in quick, story and release); `git show --stat dc6752343 | grep -c "workflows/.*yaml"` (5). The bundled set has no `release`, and its CI wait (`gh pr checks --watch`) is in two files.
- Related: #136 (the CI wait as "a fragile shell script copied into three workflows"), #251 (closed, a different split), #341.

## Open questions

None.

## Plan

### Seams
- **S1 the store's workflow loader, through `loadWorkflows` / `loadWorkflow` on a repo folder.** Observes `use:` bringing in a shared file's steps under their own names, routes, `start`, `base.step` and `base.verify` naming included steps or the `use` step, named exits routed with counters, an unrouted exit going to `$stuck`, `$done`/`$stuck` inside a shared file, the workflow's counters and `defaults:` covering included steps (they are ordinary steps of the loaded workflow), `like:`, every load-time refusal (missing shared file, clash, double use, unknown exit, nesting, keys a shared file may not hold, every bad `like:`), shared files never listed, and the loaded `source`/`hash` being the flattened text, or the file's text byte for byte when it has neither `use` nor `like`.
  Prior art: the store unit tests' "workflows" block (yaml/json loading, misplaced `mode`/`stalled` refused with the step named), which write files into a temp repo and call the loader.
- **S2 the cli, through the cli harness (`norn doctor --json`, `norn story create`, `norn story edit --workflow`, a tick, `norn story checkout` of a lost record).** Observes a shared-file refusal shown wherever a broken workflow shows today, a validation issue on an included step naming its shared file and step, a shared file never startable, an edit to a shared file after `norn story edit` making the round start refuse with `round.workflow_changed` (the pin's fingerprint is the flattened text), and a lost record restarted with the flattened workflow read from the branch.
  Prior art: the story-create, story-edit-update-branch, human (`workflow_changed`) and takeover-record-lost integration tests.
- **S3 the shipped and repo workflow sets, through the store's loader, plus `norn init` through the cli harness.** Observes the rewritten bundled `quick`/`story` and this repo's `quick`/`story`/`release` loading to exactly today's workflows, the CI wait written once per set, and `norn init` copying `shared/` (keeping existing files) with the detected test command written into the shared file that holds the test check.
  Prior art: the cli asset tests' "workflow templates" block, the repo process tests' "repo workflows" block, the init-version and init-review integration tests, the `withTestCommand` unit tests.
- **S4 the schema package, through the emitted JSON schemas.** Observes the shared-file schema (and the workflow-as-written schema) emitted next to the workflow schema.
  Prior art: the schema test that every emitted schema equals its rendered form.
- **S5 the recipes doc.** Observes "Write your own workflow" showing a shared file, `use:`, exits and `like:` and what is refused. Checked by review and the docs lints; no behaviour test.

### Coverage
| User story | Seam | Test kind | Notes |
|---|---|---|---|
| 1 `use: base-update` brings in the shared file's steps | S1 | unit | |
| 2 included steps keep their names | S1 | unit | loaded step names equal the shared file's |
| 3 routes, `base.step`, `base.verify` name an included step | S1 | unit | |
| 4 a route to the `use` step enters at the shared `start` | S1 | unit | also `start:` and `base.step` naming the `use` step |
| 5 a shared route leaves through a named exit the `use` step routes | S1 | unit | exit's `means`/`verdict` kept, `to` from the `use` step |
| 6 the `use` step's exit route takes a counter | S1 | unit | |
| 7 an unrouted exit goes to `$stuck` | S1 | unit | |
| 8 a shared route goes straight to `$done`/`$stuck` | S1 | unit | |
| 9 a shared route names a counter the workflow declares | S1 | unit | an undeclared one is refused by validation with S2's naming (19) |
| 10 the workflow's `defaults:` apply to included steps | S1 | unit | included steps are plain steps of the loaded workflow, so decide applies defaults unchanged |
| 11 `like: test` copies and replaces only the written keys | S1 | unit | shallow (D6) |
| 12 `like:` in a workflow and in a shared file | S1 | unit | |
| 13 a bad `like:` refused with its reason | S1 | unit | missing, itself, a `like` step, a `use` step, another file |
| 14 a missing shared file refused, naming file and folder | S1 | unit | |
| 15 a step name clash or a double use refused, naming both places | S1 | unit | includes the `use` step's own name |
| 16 a routed exit the shared file lacks refused | S1 | unit | |
| 17 `use:` inside a shared file refused | S1 | unit | |
| 18 a shared file key that belongs in the workflow refused | S1 | unit | `name`, `counters`, `defaults`, `mode`, `base` |
| 19 a validation issue on an included step names the shared file and step | S2 | integration | `norn doctor --json` issue message |
| 20 a shared-file refusal shows in doctor, the listing, story create, story edit | S2 | integration | |
| 21 a shared file is never listed, labelled or startable | S1 + S2 | unit + integration | listing in S1; `story edit --workflow <shared>` refused in S2; labels come from the listing |
| 22 a unit pins the flattened workflow, fingerprint over that file | S2 | integration | `round.workflow_changed` after a shared edit; pin text has no `use`/`like` |
| 23 a workflow without `use`/`like` pins byte for byte | S1 | unit | `source` equals the file text, `hash` its sha256 |
| 24 a shared file edited mid-round takes effect next round | S2 | integration | same test as 22: the running pin is unchanged, the next `story edit` takes the new text |
| 25 bundled `quick`/`story` load to today's workflows | S3 | unit | equal to `workflowHash` recorded before the rewrite, plus 29/8 and 42/10 routes/counters |
| 26 this repo's `quick`/`story`/`release` load to today's | S3 | unit | recorded `workflowHash`; `gh run watch` in exactly one file of the repo set |
| 27 `norn init` copies `shared/`, keeping existing files | S3 | integration | |
| 28 a JSON Schema for shared files is emitted | S4 | unit | |
| 29 the recipes show shared files, `use:`, exits, `like:`, refusals | S5 | review | docs lints run in the unit tier |

### Prefactoring
1. Record today's meaning of every rewritten workflow: the cli asset tests and the repo process tests load workflows through the store's loader instead of parsing YAML themselves, and assert each of bundled `quick`/`story` and repo `quick`/`story`/`release` against its `workflowHash` taken on this base. Green today; it makes 25 and 26 provable, because the rewrite must leave the hashes unchanged.
2. One store function turns a workflow file's text into a loaded workflow (parse, the name check, `source`, `hash`), used by both the listing and the lost-record restart in `norn story checkout`, which today parses and checks the name on its own. Flattening then lands in one place, and the lost-record restart pins the flattened workflow too (22).

### Implementation decisions
- D1 Flattening lives in the store, in one new module beside the workflow loader, before core validation; core, decide, receipts and golden cases see only flat workflows. It is synchronous over a reader of shared-file texts by name, and a helper names the shared files a workflow text uses, so the lost-record restart (async `git show` on the branch) reads those first and passes them in. A shared file is read from the same place as its workflow: the work tree for the listing, the branch for a lost record.
- D2 A loaded workflow's `source` is the flattened text and `hash` is that text's sha256; everything downstream (pin, `workflow_hash`, the round start's hash comparison, `norn story edit`) already reads `source`, so it changes nothing else. With neither `use` nor `like`, `source` is the file text unchanged (23). Otherwise it is the `yaml` package's serialization of the flattened document: the workflow's keys in written order, included steps in place of the `use` step in the shared file's order, and a `like` copy's keys in its target's order followed by its own new keys. No comments survive and no generated header is added.
- D3 Schemas: `workflow` stays the strict, flat schema that pins and core validation use. Two schemas are added and emitted: `workflow-source` (a workflow file as written, whose steps may be `use` or `like` steps) and `workflow-shared` (`start`, `steps`, optional `description`; steps may be `like` steps; routes may be exits). A `like` step allows the known step keys loosely; the full check runs on the copy. (Agreed with the person.)
- D4 A `use` step holds only `use: <name>` and an optional `outcomes` map from exit to a target or `{ to, counter }`. Its name must not equal any included step's name. `start`, routes and `base.step` naming it go to the shared file's `start`; `reset_on` or `base.verify` naming it is refused with a message to name the included step.
- D5 Inside a shared file a route names one of the file's own steps, `$done`/`$stuck`, or `{ exit: <name>, means?, verdict? }`. A shared file's exits are the names its exit routes use; there is no separate list. The flattened route takes `to` and `counter` from the `use` step's route for that exit and `means`/`verdict` from the shared side, or goes to `$stuck` when the exit is unrouted. A route naming a step outside the file is refused ("a shared file leaves through an exit"). (Agreed.)
- D6 `like:` is shallow: each top-level key the copy writes replaces the copied value whole. It names a step in the same file, never itself, a `like` step or a `use` step, and a `use` step cannot carry `like`. `like` is resolved within each file before `use` is flattened. (Agreed.)
- D7 Flattening errors are reported against the workflow file, so the listing still names the workflow and shows it broken wherever a broken workflow shows today. Each message names the shared file (`shared/<name>.yaml`) and the step. Paths are step pointers, which read the same in the shared file and the flattened workflow because names are kept. The loader returns which steps came from which shared file. The cli's workflow check (the shared check that observe and `norn doctor` use) prefixes a core validation issue on an included step with that file and step (19).
- D8 A shared file holding `name`, `counters`, `defaults`, `mode` or `base` is refused with "`<key>` belongs in the workflow", ahead of the schema's generic message, as misplaced step keys are today. A shared file's `description` is documentation only and does not flatten. A shared file no workflow uses is never read or validated.
- D9 The listing already reads only files directly in the workflows folder, so `shared/` is never listed, labelled or startable; S1 and S2 pin that behaviour. `norn init` copies each `shared/` file it lacks and keeps the ones it has, reporting them as `shared/<file>` under created/kept; its test command rewrite applies to every copied file, so it reaches the shared file holding the test check.
- D10 The rewrite: each set gets its own shared files (bundled and repo), following the prototype's split (sync, base update, shipping), with the CI wait in exactly one file per set. Which steps a workflow takes from a shared file, and which stay inline because they differ (`release`'s update and open-pr), is settled by the recorded `workflowHash`: a split that changes it is wrong. YAML anchors (`*test-run`) give way to `like:`. Both copies change together, and `bun run docs:emit` runs after the shipped workflows change.

### Testing decisions
A good test writes workflow and shared files and observes what the loader returns (the flat workflow, its `source` and `hash`, the listing's errors) or what a command prints with `--json`. It never calls flattening internals or checks intermediate shapes. The S1 tests use the store's loader over a temp repo; flattening needs no fakes because it is pure over files on disk. The S2 tests use the cli harness and its fake remote as the existing integration tests do; the only fakes are those system boundaries. Equivalence of the rewrite is pinned by `workflowHash`, the canonical meaning hash, so formatting or key order in the rewritten files never matters but any change of meaning does. Golden cases and transcripts must not change; a diff in them means the rewrite changed meaning.

### Risks
- The rewrite silently changes a route, counter or instruction. Prefactor 1 records the hashes first, so every rewritten file is proven against today's.
- The serialized flattened text depends on the `yaml` package's output: a dependency upgrade that changes it changes the fingerprint of workflows that use `use`/`like`. Pins already written are unaffected (they are read as they are). Only a round staged by `norn story edit` before the upgrade and started after it hits `round.workflow_changed`, which asks the person to run the edit again. Accepted.
- `norn init`'s test command rewrite finds the template's test line by pattern. Once the test check moves into a shared file, the rewrite must reach it there; S3 covers it with an init test in a repo whose build files name a test command.
- "Exit" now means two things: a check's `exits` (exit code → outcome) and a shared file's named exit. The recipes keep them apart in wording; the `{ exit: <name> }` notation stays as the spec agreed.
- `release` in this repo may share less than `quick`/`story` (its update and open-pr differ). D10 lets the hash decide what is shared rather than forcing it, but the CI wait must still be in one file.
