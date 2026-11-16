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
  - norn:wf:refinement
workflow: refinement
status: active
intake_at: 2026-11-16T13:07:56.445Z
body_hash: 051566a83f8f299b5c04600b803b4dd57821f8234a3a399096d9f6ec5e729496
refined_body_hash: 051566a83f8f299b5c04600b803b4dd57821f8234a3a399096d9f6ec5e729496
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
