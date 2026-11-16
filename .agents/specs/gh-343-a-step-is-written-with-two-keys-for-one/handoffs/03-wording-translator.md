## Goal

One store function, `translateWording(text, file)` in `packages/store/src/wording.ts` (exported from `@norn/store`), turns a workflow or shared-file text in the old wording into the new wording, byte for byte outside what it changes, or refuses it naming the file and line.

## Proof

All in `packages/store/test/unit/wording.test.ts` (unit tier):
- AC1 shipped files byte for byte: "<file> translates byte for byte to its expected file" for all 9 files in `packages/cli/assets/workflows/` and `shared/`; the expected files are in `packages/store/test/fixtures/wording/`. They were generated, then each diff against its source was checked by hand: only head keys, `skills: [X]`, split edges and `means:`/`verdict:` maps changed.
- AC2 scalars kept as written: "folded, block and quoted scalars and long lines are neither re-wrapped nor restyled"; "a multi-line meaning that would have to move to a shallower indent is refused, never reflowed".
- AC3 skill and instructions: "an agent step's skill and instructions become `agent:` (word for word) and `skills: [X]`".
- AC4 fallbacks: "…takes its description as its orientation", "with no description either, the orientation names the skill", "a gate with no prompt takes its description, or `approve or reject <step>`", "a routed outcome an agent may report with no meaning gets today's brief text; route overrides get none".
- AC5 long edges: "a long edge keeps to/counter in outcomes, means and verdict follow, its comment stays on the outcome's line"; "a block edge splits the same way".
- AC6 `agent: <name>` becomes `by:`: "a step's `agent: <name>` becomes `by: <name>`".
- AC7 unplaceable comment: "a comment left with no line to sit on refuses the file, naming the file and the comment's line".
- AC8 idempotent: "<file>'s translation translates to itself" ×9; "a translated text comes back unchanged"; "a text in the new wording comes back unchanged".
- AC9 JSON: "a JSON workflow is written back as JSON with two-space indent in its key order".
- `bun run test` and `bun run typecheck` green.

## Easy to miss

- YAML is never re-serialised. Edits are spliced into the source at the `yaml` nodes' ranges, so the `lineWidth` and flow-padding problems the spike found never come up. A moved multi-line scalar (block scalar, meaning) keeps its source text; it is refused only when its continuation lines would not sit deeper than its new key.
- The head goes in the step's first key position. Leading comments of the removed keys (`type`, `action`, `instructions`/`run`/`prompt`) move above the head. A trailing comment goes on the head's line (after a block scalar's header). Two trailing comments for one line, or one after a header that already has one, refuse the file at the first one's line.
- Fallback meanings are written only for steps in the old wording, so a step already in the new wording is never changed.
- JSON: a text starting with `{` that parses as JSON goes through an object path (`JSON.stringify(…, null, 2)`). A JSON text with nothing old comes back untouched, even if it is not two-space indented.

## Not proven yet

- That the output loads to the same workflow: slice 04 owns that, since no loader for the new wording exists yet.
- `like` copies: an old copy's `instructions`/`run`/`prompt` keys are renamed in place (no first-position move, no fallbacks). An old copy of an agent step that writes `outcomes:` gets a `means:` map with fallbacks. Its target's `verdict:` map is still inherited under the new wording's shallow merge. Slice 04 should decide whether that is right.

## Notes

- `means` on a step that is not an agent step (e.g. `{ exit: tested, means: … }` on a check, as in the store `shared-workflows.test.ts` fixture) is dropped. Nothing ever read it, and story 23 would refuse it in a `means:` map. This is a judgement call to confirm in review.
- Refused, rather than guessed at: a step written as a flow map that needs a change, a multi-line flow edge, a comment inside a block edge being split, a step that already has a `means:`/`verdict:` map next to old in-edge prose, and a git `action` with no verb.
- Fixture loop: `bun test packages/store/test/unit/wording.test.ts`. To regenerate an expected file, run the translator on the shipped file and review the diff before committing it.

## Resume

Review of slice 03 (the translator in `packages/store/src/wording.ts` and its tests). Slice 04 calls `translateWording` for copy reads (`toJS` of the text it returns), and slice 08 writes the text out.
