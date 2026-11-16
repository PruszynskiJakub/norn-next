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
  - norn:wf:refinement
workflow: refinement
status: new
intake_at: 2026-11-16T15:23:54.534Z
body_hash: 7fbc55d648d29da4c82b1f01627eee670941563520c70a99287cf49a8e7474ca
---

## Observed

On `main` (`e419d33bd`), norn 0.33.0.

- A step says what it is in two keys: `type: agent` + `skill:`, `type: check` + `run:`, `type: git` + `action:`, `type: gate` + `prompt:` (`packages/schema/src/workflow.ts:76-177`).
- An agent step must name exactly one skill; `instructions` is optional (`workflow.ts:80-81`). The brief prints "Use the `<skill>` skill." (`packages/core/src/brief.ts:869`). `triage` and `reproduce` carry a skill and a paragraph of instructions that does the steering.
- An agent edge is the long form `{ to, counter, means, verdict }` whenever it has a meaning (`workflow.ts:16-25`), which is nearly every agent edge. Routing and prose share a line.

## Wanted

For whoever writes or reads a workflow, person or agent.

1. A step opens with exactly one key that says what happens:

   | Today | New |
   |---|---|
   | `type: agent` + `instructions:` | `agent: <orientation>` |
   | `type: check` + `run:` | `check: <command>` |
   | `type: gate` + `prompt:` | `gate: <what the person decides>` |
   | `type: git`, `action: update` | `update-branch:` |
   | `type: git`, `action: open-pr` | `open-pr:` |
   | `type: git`, `action: integrate` | `integrate:` |
   | `type: git`, `action: push` | `push:` |
   | `type: merge` | `await-merge:` |
   | `type: slices` | `slices:` |

2. On an agent step the orientation is required and non-empty. `skills:` is an optional list. Each named skill is checked at load as `skill` is today (`unknown_skill`, `packages/core/src/workflow.ts:169-178`). With no `skills`, the brief names no skill.
3. `outcomes:` holds `outcome: target` only. Meanings move to a sibling `means:` map and verdicts to a sibling `verdict:` map, on agent steps. The long edge form remains only for `{ to, counter }`.
4. norn refuses, at load, a reportable agent outcome with a route and no meaning, and a meaning or verdict with no route. The overridable routes (`silent`, `died`, `timeout`, `stalled`, `ask`, `stuck`) need no meaning.

Must hold:

- The loaded workflow is the same `Workflow` value decide reads today; no golden case changes its decisions.
- Files in `.agents/workflows/` are accepted only in the new wording. `norn upgrade` rewrites them; the rewrite is mechanical and lossless.
- A unit's pinned workflow written by an older norn still loads (assumption from the session, to confirm in refinement).
- The JSON Schema (`bun run schema:emit`), the shipped workflows in `packages/cli/assets/workflows/`, this repo's copies, `docs/concepts.md`, `docs/recipes.md` and the generated reference use the new wording.
- A file in the old wording is refused with a `do_instead` naming `norn upgrade`.

Not in scope: counters (separate issue), shared steps (#342), gates' new keys, hand-backs.

Design record: https://gist.github.com/PruszynskiJakub/0dcf9042145fe9c46f32bd9b8b94fb19 (see `quick.yaml`). Related: #341, #342.

## Where

- `packages/schema/src/workflow.ts:16-177`: edge and step schemas
- `packages/store/src/unit.ts:35`: `parseWorkflowText`
- `packages/core/src/workflow.ts:101`: `validateWorkflowDefinition`
- `packages/core/src/brief.ts:182,270,869`: the skill in the brief; `:730-735`: finish lines from `means`
- `packages/cli/src/commands/upgrade.ts`
- `packages/cli/src/reference.ts:118`: `workflowLine`
