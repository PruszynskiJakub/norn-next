## Goal

One store function, `translateWording(text, file)` in `packages/store/src/wording.ts` (exported from `@norn/store`), turns a workflow or shared-file text in the old wording into the new wording, byte for byte outside what it changes, or refuses it naming the file and line.

## Proof

Unit tier; review #1 read each test and saw it assert its criterion. `bun run test` and `bun run typecheck` are green.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | each shipped workflow and shared file translates byte for byte to a hand-checked expected file (`packages/store/test/fixtures/wording/`) | test | `packages/store/test/unit/wording.test.ts` › "<file> translates byte for byte to its expected file" ×9 |
| AC2 | folded, block and quoted scalars and long lines are not re-wrapped or restyled, whether moved or not; a scalar that cannot be kept is refused | test | `packages/store/test/unit/wording.test.ts` › "folded, block and quoted scalars and long lines are neither re-wrapped nor restyled", "a multi-line meaning that would have to move to a shallower indent is refused, never reflowed" (gap: F2) |
| AC3 | `skill` + `instructions` become `agent: <instructions word for word>` + `skills: [X]` | test | `packages/store/test/unit/wording.test.ts` › "an agent step's skill and instructions become `agent:` (word for word) and `skills: [X]`" |
| AC4 | fallbacks: orientation from description, else "Use the `X` skill."; gate text from description, else `approve or reject <step>`; a reportable outcome with no meaning gets `step finished with outcome <o>` | test | `packages/store/test/unit/wording.test.ts` › the four "fallbacks" tests |
| AC5 | a long edge keeps `to`/`counter` in `outcomes:`, `means:`/`verdict:` maps follow, its comment stays on the outcome's line | test | `packages/store/test/unit/wording.test.ts` › "a long edge keeps to/counter in outcomes…", "a block edge splits the same way" (gap: F1) |
| AC6 | a step's `agent: <name>` becomes `by: <name>` | test | `packages/store/test/unit/wording.test.ts` › "a step's `agent: <name>` becomes `by: <name>`" (gap: F3, `like` copies) |
| AC7 | a comment left with no line to sit on refuses the file, naming the file and line | test | `packages/store/test/unit/wording.test.ts` › "a comment left with no line to sit on refuses the file…" (gap: F1) |
| AC8 | a translated text, or one already in the new wording, comes back unchanged | test | `packages/store/test/unit/wording.test.ts` › "<file>'s translation translates to itself" ×9, "a translated text comes back unchanged", "a text in the new wording comes back unchanged" |
| AC9 | a JSON workflow stays JSON, two-space indent, in its key order | test | `packages/store/test/unit/wording.test.ts` › "a JSON workflow is written back as JSON with two-space indent in its key order" |

## Easy to miss

- YAML is never re-serialised. Edits are spliced into the source at the `yaml` nodes' ranges, so the `lineWidth` and flow-padding problems the spike found never come up. A moved multi-line scalar (block scalar, meaning) keeps its source text; it is refused only when its continuation lines would not sit deeper than its new key.
- The head goes in the step's first key position. Leading comments of the removed keys (`type`, `action`, `instructions`/`run`/`prompt`) move above the head. A trailing comment goes on the head's line (after a block scalar's header). Two trailing comments for one line, or one after a header that already has one, refuse the file at the first one's line.
- Fallback meanings are written only for steps in the old wording, so a step already in the new wording is never changed.
- JSON: a text starting with `{` that parses as JSON goes through an object path (`JSON.stringify(…, null, 2)`). A JSON text with nothing old comes back untouched, even if it is not two-space indented.

## Not proven yet

- Review #1 asked for changes, with 3 blocking findings, each reproduced by the probe in the review evidence (`probe.ts`, `probe-output.txt`):
  - F1: a comment on a block edge's outcome key line (`pass: # c` with `to`/`means` below it) is dropped when the edge collapses to its bare target (`edgeEdits`, wording.ts:375).
  - F2: a `#` line at the end of a block scalar just above `type:`/`run:`/… is taken as a leading comment and moved out of the scalar (`spanOf`, wording.ts:217).
  - F3: a `like` copy's `agent: <name>` is not renamed to `by:`. In the new wording it would read as an orientation (wording.ts:272, and the JSON path).

- That the output loads to the same workflow: slice 04 owns that, since no loader for the new wording exists yet.
- `like` copies: an old copy's `instructions`/`run`/`prompt` keys are renamed in place (no first-position move, no fallbacks). An old copy of an agent step that writes `outcomes:` gets a `means:` map with fallbacks. Its target's `verdict:` map is still inherited under the new wording's shallow merge. Slice 04 should decide whether that is right.

## Notes

- `means` on a step that is not an agent step (e.g. `{ exit: tested, means: … }` on a check, as in the store `shared-workflows.test.ts` fixture) is dropped. Nothing ever read it, and story 23 would refuse it in a `means:` map. This is a judgement call to confirm in review.
- Refused, rather than guessed at: a step written as a flow map that needs a change, a multi-line flow edge, a comment inside a block edge being split, a step that already has a `means:`/`verdict:` map next to old in-edge prose, and a git `action` with no verb.
- Review #1: dropping `means` on a step that is not an agent step is accepted. Minor, not rework: a YAML parse error comes back `ok`/unchanged (wording.ts:148; slice 08 may want to refuse it), and the comment on `apply()` says insertions go first, but the code applies removals first (the order is right).
- Fixture loop: `bun test packages/store/test/unit/wording.test.ts`. To regenerate an expected file, run the translator on the shipped file and review the diff before committing it.

## Resume

Rework for review #1: fix F1, F2 and F3 in `packages/store/src/wording.ts` (keep or refuse each case, never lose it silently), each with a test in `packages/store/test/unit/wording.test.ts`. Then check that the 9 fixture tests still pass unchanged.
