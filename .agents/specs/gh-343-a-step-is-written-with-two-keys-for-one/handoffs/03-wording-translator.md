## Goal

One store function, `translateWording(text, file)` in `packages/store/src/wording.ts` (exported from `@norn/store`), turns a workflow or shared-file text in the old wording into the new wording, byte for byte outside what it changes, or refuses it naming the file and line.

## Proof

Unit tier; review #1 read each test and saw it assert its criterion; the three blocking findings it raised each have a test now (went red first). `bun run test` and `bun run typecheck` are green.

| Criterion or story | What it says | Verifier | Proven by |
| --- | --- | --- | --- |
| AC1 | each shipped workflow and shared file translates byte for byte to a hand-checked expected file (`packages/store/test/fixtures/wording/`) | test | `packages/store/test/unit/wording.test.ts` › "<file> translates byte for byte to its expected file" ×9 |
| AC2 | folded, block and quoted scalars and long lines are not re-wrapped or restyled, whether moved or not; a scalar that cannot be kept is refused | test | `packages/store/test/unit/wording.test.ts` › "folded, block and quoted scalars and long lines are neither re-wrapped nor restyled", "a multi-line meaning that would have to move to a shallower indent is refused, never reflowed", "a block scalar ending in a `#` line just above a removed key keeps that line" |
| AC3 | `skill` + `instructions` become `agent: <instructions word for word>` + `skills: [X]` | test | `packages/store/test/unit/wording.test.ts` › "an agent step's skill and instructions become `agent:` (word for word) and `skills: [X]`" |
| AC4 | fallbacks: orientation from description, else "Use the `X` skill."; gate text from description, else `approve or reject <step>`; a reportable outcome with no meaning gets `step finished with outcome <o>` | test | `packages/store/test/unit/wording.test.ts` › the four "fallbacks" tests |
| AC5 | a long edge keeps `to`/`counter` in `outcomes:`, `means:`/`verdict:` maps follow, its comment stays on the outcome's line | test | `packages/store/test/unit/wording.test.ts` › "a long edge keeps to/counter in outcomes…", "a block edge splits the same way", "a comment on a block edge's outcome key stays on that line when the edge becomes its bare target" |
| AC6 | a step's `agent: <name>` becomes `by: <name>` | test | `packages/store/test/unit/wording.test.ts` › "a step's `agent: <name>` becomes `by: <name>`" "a `like` copy's `agent: <name>` becomes `by: <name>` in a file in the old wording", "a JSON `like` copy's `agent: <name>` becomes `by: <name>`" |
| AC7 | a comment left with no line to sit on refuses the file, naming the file and line | test | `packages/store/test/unit/wording.test.ts` › "a comment left with no line to sit on refuses the file…", "a comment on a block edge's outcome key stays on that line…" |
| AC8 | a translated text, or one already in the new wording, comes back unchanged | test | `packages/store/test/unit/wording.test.ts` › "<file>'s translation translates to itself" ×9, "a translated text comes back unchanged", "a text in the new wording comes back unchanged" |
| AC9 | a JSON workflow stays JSON, two-space indent, in its key order | test | `packages/store/test/unit/wording.test.ts` › "a JSON workflow is written back as JSON with two-space indent in its key order" |

## Easy to miss

- A `#` line counts as a leading comment of a key only below the end of the pair before it (`spanIn`): above that it is the previous value's text, e.g. a shell script in `run: |`.
- A block edge that collapses to its bare target keeps the comment on its outcome key's line after the target (`pass: describe # c`).
- In a file in the old wording (mixed counts as old), `agent:` on a `like` copy is the agent's name and becomes `by:`, even when the copy has nothing else old (YAML `byEdit`, JSON path).

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
- Review #1 (round 1 rework done): the comment-on-outcome-key, `#`-line-in-block-scalar and like-copy `agent:` findings are fixed with tests. Dropping `means` on a step that is not an agent step is accepted. Minor, not rework: a YAML parse error comes back `ok`/unchanged (wording.ts:148; slice 08 may want to refuse it), and the comment on `apply()` says insertions go first, but the code applies removals first (the order is right).
- Fixture loop: `bun test packages/store/test/unit/wording.test.ts`. To regenerate an expected file, run the translator on the shipped file and review the diff before committing it.

## Resume

Nothing open in this slice: review the rework diff (wording.ts `spanIn`, `byEdit`, `edgeEdits` comment) against the three findings.
