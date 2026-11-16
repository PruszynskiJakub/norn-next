### Goal
norn loads a workflow written in the new wording (one head key, optional `skills:`, `by:`, `outcomes:` with sibling `means:` / `verdict:`) to the same `type`-tagged model as today, refuses malformed shapes naming the step, and still loads old-wording files everywhere through the translation.

### Proof
`bun run test` (2031 pass) and `bun run typecheck` green. All in `packages/store/test/unit/new-wording.test.ts` unless named otherwise:
- AC1 agent/check/gate by head key load the same as today's wording: "agent, check and gate steps load to the same workflow as today's wording"
- AC2 value-less verbs, their kinds' outcomes, a verb with a value refused: "`%s:` with no value loads as today's step of its kind" ×6, "a verb takes only its kind's outcomes…", "a verb given a value is refused, naming the step"
- AC3 two head keys or none refused: "a step with two head keys, or none, is refused naming the step"; `use:` unchanged: `shared-workflows.test.ts` (all green) and the shared-file case below
- AC4 `like` inherits the head key; a different one is two: "a like copy has its target's head key…"
- AC5 missing/empty orientation refused: "an orientation that is missing or empty (%s)…" ×3
- AC6 skills optional, a set: "skills are optional and a set…"
- AC7 `by:` picks the agent, its skills checked as `unknown_skill`: "`by:` picks the configured agent…"
- AC8 edges carry meaning and verdict: "each route carries the meaning and verdict…"; brief finish lines unchanged: `packages/core/test/unit/brief.test.ts` snapshots untouched and green
- AC9 routed reportable outcome without meaning refused, overridables free: "a routed outcome the agent may report with no meaning is refused…"
- AC10 stale meaning/verdict, prose off agent steps: "a meaning or verdict for an outcome the step does not route…", "`means:` and `verdict:` on a step that is not an agent step…"
- AC11 shared `{ exit }` routes with means from the shared `means:`: "a shared file's exits leave through the use step's routes…"
- AC12 shipped old vs translation load equal: "each shipped workflow and shared file loads to the same workflow as its translation"; golden decisions byte-identical: `packages/core/test/unit/golden.test.ts` (embedded models rebuilt from each case's `source` through the loader, cases renamed by `git mv` to their new stable keys; no decision changed)
- AC13 old wording loads from checkout and copy: "a file in today's wording still loads, from the main checkout or a copy" and the unchanged old-wording fixtures in `shared-workflows.test.ts`
- Seen red: stubbing `stepWordingErrors` to `[]` fails 10 of the 23 tests; stubbing the means/verdict merge fails the 2 edge tests.

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
Implement done; next is review of the diff against the 13 criteria above.
