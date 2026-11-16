---
id: gh-343/04
title: Load workflows written in the new wording (old wording still accepted)
depends_on: [ gh-343/02, gh-343/03 ]
status: integrated
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
  - { id: AC7, verifier: test }
  - { id: AC8, verifier: test }
  - { id: AC9, verifier: test }
  - { id: AC10, verifier: test }
  - { id: AC11, verifier: test }
  - { id: AC12, verifier: test }
  - { id: AC13, verifier: test }
---

## Goal
Expand step: a workflow author can write every step with one head key (`agent:`, `check:`, `gate:`, a value-less verb, `use:`), optional `skills:`, `by:`, and `outcomes:` with sibling `means:` / `verdict:`; norn loads it to the same workflow model as today's wording and refuses the malformed shapes naming the step. Old-wording files still load everywhere (through the translator), so nothing breaks while files move over.

## Scope
User stories: agent, check and gate steps by their head key; the value-less verbs with their kinds' outcomes; `use:` unchanged; two head keys or none refused; a verb with a value refused; `like` inheriting the head key; missing orientation refused; `skills:` optional and a set; `by:` picking the agent; plain `outcomes:` map; sibling `means:` / `verdict:`; the reportable-outcome meaning rule; stale meanings refused; overridable routes needing no meaning; `means`/`verdict` only on agent steps; shared `{ exit }` routes; same decisions in either wording; a translated file loading to the same workflow. Seams: S1, S2, S4. Out: refusing the old wording in the main checkout (slice 09); rewriting shipped files (slice 05).

## Acceptance
- AC1 Given an agent step `agent: <orientation>` with `skills`, `inputs`, `outcomes`, `means`, `verdict`, `by`, `model`, `attended`, `deadline`, `nudges`, `retries`, `criteria`, `description` beside it, a check step `check: <command>` with `timeout`, `exits`, `outcomes`, and a gate `gate: <decision>`, when the file loads, then it loads to the same workflow as today's wording for those steps (the orientation as the instructions, the command as the check's command, the gate text as what the inbox shows). — verifier: test
- AC2 Given each verb `update-branch:`, `open-pr:`, `integrate:`, `push:`, `await-merge:`, `slices:` with no value, when the file loads, then it loads as today's git, merge or slices step and accepts exactly that kind's outcomes (`clean`/`resolved` only on `update-branch`); a verb with a value (`open-pr: now`) is refused naming the step. — verifier: test
- AC3 Given a step with two head keys (e.g. `agent:` and `check:`) or none, when the file loads, then it is refused naming the step; a `use:` step loads exactly as today. — verifier: test
- AC4 Given a `like` copy, when the file loads, then the copy has its target's head key, and a copy writing a different head key is refused for two head keys. — verifier: test
- AC5 Given an agent step with a missing or empty orientation, when the file loads, then it is refused naming the step. — verifier: test
- AC6 Given an agent step with no `skills:`, when the file loads, then it loads; given one naming the same skill twice, it is refused naming the step and skill. — verifier: test
- AC7 Given `by: <name>` on a step, when the workflow loads, then the step runs on that configured agent, and without `by:` on the config's default agent; a skill not visible to the agent `by:` picks is refused as `unknown_skill`. — verifier: test
- AC8 Given `outcomes:` holding `outcome: target` and `{ to, counter }`, with `means:` and `verdict:` maps beside it on an agent step, when the file loads, then each edge carries its meaning and verdict and the brief's finish lines read exactly as today. — verifier: test
- AC9 Given an agent step routing an outcome the agent may report with no meaning, when the file loads, then it is refused naming the step and outcome; the overridable routes (`silent`, `died`, `timeout`, `stalled`, `ask`, `stuck`) load without a meaning. — verifier: test
- AC10 Given a meaning or verdict for an outcome the step does not route, or `means:` / `verdict:` on a step that is not an agent step, when the file loads, then it is refused naming the step (and the outcome). — verifier: test
- AC11 Given a shared file in the new wording and a workflow using it, when it loads, then its `{ exit: … }` routes leave as today, with meanings from the shared file's `means:` map. — verifier: test
- AC12 Given each shipped workflow and shared file in today's wording and its translation, when both load, then the loaded workflows are equal, and the golden cases (embedded workflows filled with the orientation and gate fallbacks) keep every decision byte-identical. — verifier: test
- AC13 Given a file in today's wording, in the main checkout or a copy, when it loads, then it still loads (through the translator) as before this slice. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D1, D2, D6, D8. The model stays the `type`-tagged union; instructions and gate prompt become required in the model, so old text gets them from the translator's fallbacks. New-wording checks run before the model schema so the union's noise never reaches the person. This is the largest slice: if it does not fit one context, the person may split it into steps (head keys) and routes (outcomes/means/verdict); they share the loader, so I kept them together rather than make two parallel slices conflict.
