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
---

## Observed

On `main` (`e419d33bd`), norn 0.33.0.

A workflow file must contain every step it uses; there is no way to include steps from another file. The same steps are therefore written out in several workflows:

- 13 of `quick`'s 15 steps have a body identical to the same-named step in `story`. 10 are identical including their routes: `sync-resolve`, `update`, `resolve`, `test-merge`, `test-resolution`, `resolution-review`, `open-pr`, `ci`, `ready`, `merge`. Measured by parsing `.agents/workflows/quick.yaml` and `story.yaml` and comparing each step.
- The CI wait, a 30-line shell script, is inline in three files: `.agents/workflows/quick.yaml:113`, `story.yaml:147` and `release.yaml`.
- Within one file, `test`, `test-merge` and `test-resolution` are the same check with different routes. A YAML anchor (`&test-run`) shares only the command, and only inside that file.

The cost shows in history: three changes each had to edit five workflow files to change one behaviour.

- `dc6752343` (#334): the ci check on a conflicting PR
- `e6d970181` (#324): the ci check pointing to failures
- `bc7784ba6` (#338): the base move and the light path

#136 already described the CI wait as "a fragile shell script copied into three workflows".

## Wanted

A workflow can include steps kept in a shared file, and the included steps are flattened into the workflow when it is loaded. For whoever edits workflows: a fix to the CI wait, the base update or the shipping steps is made in one place.

Proposed shape, to be settled in refinement:

- A step may be `use: <name>`, naming a shared file of steps. Inside that file a route may leave with `exit <name>`; the including step routes each exit like any outcome.
- A step may be `like: <step>`, copying another step in the same file with different routes.
- The loaded workflow is the same flat graph as today. Validation (`validateWorkflowDefinition`), the `open_pr_bypass` rule, counters, decide, receipts and the golden cases see no shared files.
- A unit pins the flattened workflow, since one file's text no longer holds the whole workflow.

Must hold:

1. `quick` and `story` rewritten with shared steps load to exactly the edges and counters they have today (29 edges and 8 counters; 42 and 10).
2. A validation issue in an included step names the shared file and the step, not only the flattened path.
3. A shared file is not listed as a workflow, gets no `norn:wf:<name>` label and cannot be started as a round.
4. A shared file that is missing, includes itself, or collides on a step name is refused when the workflow loads, with the reason.
5. An exit the including step does not route goes to `$stuck`, as an undeclared outcome does today.
6. The docs (`docs/recipes.md`, "Write your own workflow") and the shipped workflows in `packages/cli/assets/workflows/` use it.

Three questions for refinement:

- `story` enters the shared base-update steps in the middle: `review.approve` goes to `test`, and `base.verify` names `test`. Either inner steps stay addressable by name after flattening, or a shared file gets a second entry.
- One shared file used twice in a workflow collides on step names.
- This repo's workflows differ from the bundled ones by 10 to 56 lines per file (check commands, the CI wait, instructions). Shared files could carry that difference, or leave it as it is.

Not in scope: counters, the light path's behaviour, step wording, and anything that changes how a unit runs.

A throwaway prototype in another notation showed must-hold 1 is reachable: `quick` and `story` written with three shared files (`sync`, `base-update`, `ship`) flattened to the same edges and counter budgets as today's files.

Related: #136, #251 (closed, not planned: story versus slice level, a different split), #341 (a skill for writing workflows, which would teach this).

## Repro

    grep -c "gh run watch" .agents/workflows/*.yaml      # 1 in quick, story and release
    grep -c "test-run" .agents/workflows/quick.yaml      # 3: one anchor, two aliases
    git show --stat dc6752343 | grep -c "workflows/.*yaml"   # 5

## Where

- `packages/store/src/config.ts:330`: `listWorkflowFiles`, every file in `.agents/workflows/` is a workflow
- `packages/store/src/config.ts:345`: `loadFile`, one file is one workflow
- `packages/store/src/unit.ts:35`: `parseWorkflowText`
- `packages/store/src/unit.ts:82`: `pinWorkflow`, pins the file's text and its hash
- `packages/schema/src/workflow.ts:217`: the `Workflow` schema
- `packages/core/src/workflow.ts:101`: `validateWorkflowDefinition`
- `packages/core/src/workflow.ts:302`: `openPrBypassIssues`
- `packages/cli/src/runtime/workflows.ts:49`: `repoWorkflows`, validation per loaded workflow
- `packages/core/src/decide/story.ts:552`: `roundStart`, compares the workflow file's hash with the receipt's
- `.agents/workflows/` and `packages/cli/assets/workflows/`
