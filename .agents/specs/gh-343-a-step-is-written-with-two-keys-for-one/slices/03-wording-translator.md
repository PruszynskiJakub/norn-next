---
id: gh-343/03
title: Translate a workflow file from the old wording to the new, losslessly
depends_on: []
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
---

## Goal
One store function takes a workflow or shared-file text in the old wording and returns the same file in the new wording, byte for byte outside what it changes, or refuses it naming the file and line. Proven first against every shipped workflow and shared file as fixtures, since the lossless rewrite is the plan's biggest risk.

## Scope
User stories: comments, key order and scalar styles kept; a split edge's comment kept on its outcome's line; an unplaceable comment refusing the file with its line; `skill` → `skills: [X]` and instructions kept word for word as the orientation; orientation and gate fallbacks; `agent: <name>` → `by:`; a second run changing nothing; JSON stays JSON. Seams: S5. Out: loading the result (slice 04, which proves it loads to the same workflow); `norn upgrade` writing files (slice 08).

## Acceptance
- AC1 Given each shipped workflow and shared file in today's wording, when translated, then the output equals a hand-checked expected file byte for byte: every comment, the key order and every untouched key's text are as written, `type`/`action`/`run`/`prompt`/`instructions` are replaced by the one head key in the step's first key position, and flow lists are written unpadded (`[X]`). — verifier: test
- AC2 Given folded and block scalars, long lines and quoted strings in a fixture, when translated, then none is re-wrapped or restyled, whether left in place or moved (an orientation, a meaning); where a scalar cannot be kept as written, the file is refused naming the file and line, never reflowed. — verifier: test
- AC3 Given an agent step with `skill: X` and `instructions`, when translated, then it reads `agent: <the instructions, word for word>` and `skills: [X]`. — verifier: test
- AC4 Given an agent step with a skill and no instructions, when translated, then its orientation is its `description`, or with no description the line ``Use the `X` skill.``; given a gate with no prompt, its text is its `description`, or with none `approve or reject <step>`; given a routed outcome an agent may report with no meaning, its meaning is `step finished with outcome <o>`. — verifier: test
- AC5 Given a long edge `{ to, counter, means, verdict }`, when translated, then `outcomes:` keeps only `to`/`counter` (or the bare target), `means:` and `verdict:` maps follow `outcomes:`, and a trailing comment on that edge stays on the outcome's line in `outcomes:`. — verifier: test
- AC6 Given a step whose `agent: <name>` picks its agent, when translated, then it reads `by: <name>`. — verifier: test
- AC7 Given a comment the translation leaves with no node to sit on, when translated, then the file is refused with the file name and the comment's line. — verifier: test
- AC8 Given a translated text, or any text already in the new wording, when translated again, then it comes back unchanged. — verifier: test
- AC9 Given a workflow written as JSON, when translated, then the output is JSON with two-space indent and its key order. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
D3, D3a; spike notes in the handoff (flow lists padded by default; folded scalars re-wrapped). Splicing the original source range for untouched and moved scalars is the route the plan names; prove AC2 before anything else. If keeping scalar source text turns out impossible with the library, that is a plan change: report it rather than loosening AC2.
