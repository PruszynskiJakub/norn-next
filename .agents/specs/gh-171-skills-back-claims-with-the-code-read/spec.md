---
id: gh-171
slug: skills-back-claims-with-the-code-read
provider: gh
number: 171
url: https://github.com/PruszynskiJakub/norn-next/issues/171
title: "Skills: back claims with the code, read test helpers first, state how a terse answer was read"
assignee: PruszynskiJakub
labels:
  - norn
  - norn:wf:quick
workflow: quick
status: new
intake_at: 2026-11-03T10:52:31.990Z
body_hash: f322872f9329d018bd3ddb138ef226c91de61daedd710b1b9bb86258abd122b9
---

## Observed

Three habits in agent steps keep producing rework:

1. **Claims made without reading the code.** In the gh-64 config refinement an agent explained config keys such as `capabilities` from the schema and got them wrong. It only checked the code after the person asked whether the keys had any real effect. Those answers fed straight into a 55-item spec.
2. **Tests written before reading the existing helpers.** First drafts used the wrong mailbox ref prefix, asserted on a `round` field that round 1 state doesn't have, or introduced an import cycle. Each needed another red–green pass.
3. **Guessing at terse answers in interviews.** Answers like "Remove these" or "PRD can be removed" led to an extra question or a wrong assumption.

## Wanted

The bundled skills carry three rules:

- `norn-triage`, `norn-refine`: back every claim about what code or config does with the `file:line` usages that consume it. Never infer behaviour from the schema or the docs alone. Flag keys that are defined but never read.
- `norn-implement`, `norn-tdd`: before writing a test, read the existing test helpers, fixtures and harness fakes, and the shape of the state the test asserts on.
- `norn-interview` (and `norn-refine`, `norn-clarify`): when an answer is terse, state your interpretation in one line and carry on; the person corrects it if it's wrong.

## Where

- `packages/cli/assets/skills/{norn-triage,norn-refine,norn-implement,norn-tdd,norn-interview,norn-clarify}/SKILL.md`
