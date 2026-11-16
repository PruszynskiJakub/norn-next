### Goal
norn loads a workflow written in the new wording (one head key, optional `skills:`, `by:`, `outcomes:` with sibling `means:` / `verdict:`) to the same `type`-tagged model as today, refuses malformed shapes naming the step, and still loads old-wording files everywhere through the translation.

### Proof
Review #2 approved: `bun run test` (2033 pass) and `bun run typecheck` pass on HEAD. The golden decisions were compared case by case with the base: all 139 are identical, and only the embedded facts moved. Each row below was read against its test.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | agent/check/gate steps by their head key load to the same workflow as today's wording | test | `packages/store/test/unit/new-wording.test.ts` › "agent, check and gate steps load to the same workflow as today's wording" |
| AC2 | value-less verbs load as today's git/merge/slices steps with their kinds' outcomes; a verb with a value is refused | test | `packages/store/test/unit/new-wording.test.ts` › "`%s:` with no value loads as today's step of its kind", "a verb takes only its kind's outcomes…", "a verb given a value is refused, naming the step" |
| AC3 | two head keys or none are refused, naming the step; `use:` loads as today | test | `packages/store/test/unit/new-wording.test.ts` › "a step with two head keys, or none, is refused naming the step"; `packages/store/test/unit/shared-workflows.test.ts` |
| AC4 | a `like` copy has its target's head key; writing a different one is two head keys | test | `packages/store/test/unit/new-wording.test.ts` › "a like copy has its target's head key…" |
| AC5 | a missing or empty orientation is refused, naming the step | test | `packages/store/test/unit/new-wording.test.ts` › "an orientation that is missing or empty (%s)…" |
| AC6 | `skills:` is optional; a skill named twice is refused | test | `packages/store/test/unit/new-wording.test.ts` › "skills are optional and a set…" |
| AC7 | `by:` picks the configured agent; its skills are checked as `unknown_skill` | test | `packages/store/test/unit/new-wording.test.ts` › "`by:` picks the configured agent…" |
| AC8 | each edge carries its meaning and verdict from the sibling maps; brief finish lines unchanged | test | `packages/store/test/unit/new-wording.test.ts` › "each route carries the meaning and verdict…"; `packages/core/test/unit/brief.test.ts` snapshots |
| AC9 | a reportable routed outcome with no meaning is refused; overridable routes need none | test | `packages/store/test/unit/new-wording.test.ts` › "a routed outcome the agent may report with no meaning is refused…" |
| AC10 | a stale meaning or verdict, or `means:`/`verdict:` off an agent step, is refused | test | `packages/store/test/unit/new-wording.test.ts` › "a meaning or verdict for an outcome the step does not route…", "`means:` and `verdict:` on a step that is not an agent step…", "a `%s:` that is not a map is refused naming the step" |
| AC11 | shared `{ exit }` routes leave as today, with meanings from the shared `means:` | test | `packages/store/test/unit/new-wording.test.ts` › "a shared file's exits leave through the use step's routes…" |
| AC12 | shipped files and their translations load equal; golden decisions byte-identical | test | `packages/store/test/unit/new-wording.test.ts` › "each shipped workflow and shared file loads to the same workflow as its translation"; `packages/core/test/unit/golden.test.ts` |
| AC13 | a file in today's wording still loads from the checkout or a copy | test | `packages/store/test/unit/new-wording.test.ts` › "a file in today's wording still loads, from the main checkout or a copy" |

### Easy to miss
- Loading uses the value translation `translateWordingValue` (new export in `wording.ts`, the same step mapping as the JSON path), not the lossless text rewrite. The text rewrite refuses flow-map steps and other layouts, and a copy must load anyway. `inNewWording(text)` gives the YAML text that flattening reads.
- A text with no `use`/`like` is still pinned as written, old wording too. A text with `use`/`like` pins the flattened text in the new wording, so its pin hash changes for old files with `use` (the shipped story/quick).
- The model now requires `instructions` (agent) and `prompt` (gate). The old-wording file schemas (`workflow-source`, `workflow-shared`, still emitted until slice 05) keep them optional. The loader checks shared files against a model-shaped `WorkflowSharedModel`, which is not published.
- The brief leaves out an orientation that equals the description or the skill line. Those are the translator's fallbacks, so an old pin's brief reads as before.

### Not proven yet
- Integration and e2e tiers are not run locally (CI runs them). Old-wording workflows in those tests load through the translation. Where a test reads a model or a pin text, it may now see fallback `instructions`, `prompt` or `means`, or a flattened pin in the new wording.

### Notes
- Pinned-meaning hashes (`packages/cli/test/unit/assets.test.ts`, `test/repo/process.test.ts` quick/story) were re-pinned. Stripping the three fallbacks from the new models reproduced every old hash exactly, so the only change is the fallbacks.
- `bun run schema:emit` was run: `workflow.schema.json` (the model) now requires `instructions`/`prompt`. Slice 05 owns the new-wording schemas.
- A gate with a description and no prompt now shows its description in the inbox. This is the owner's fallback (story 41).
- Removed slice 02's file-wording check (`fileSkillWording`/`withSkillLists`). The translator now does `skill` → `skills`.
- Friction: none.

### Resume
Review #2 approved the slice: the review #1 finding (a scalar `means:`/`verdict:` was dropped silently) is fixed at `packages/store/src/step-wording.ts:80`. Next is QA against AC1–AC13.
