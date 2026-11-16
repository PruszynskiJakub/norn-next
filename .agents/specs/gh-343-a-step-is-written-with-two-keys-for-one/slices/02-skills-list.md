---
id: gh-343/02
title: An agent step carries a list of skills, and the brief names each
depends_on: []
status: active
criteria:
  - { id: AC1, verifier: test }
  - { id: AC2, verifier: test }
  - { id: AC3, verifier: test }
  - { id: AC4, verifier: test }
  - { id: AC5, verifier: test }
  - { id: AC6, verifier: test }
---

## Goal
Prefactor that users can already see in the brief: a loaded agent step holds an optional list of skills instead of exactly one, today's `skill: X` loads as a one-item list, and the brief's Your work line names zero, one or several skills before the step's instructions. decide decides exactly as before.

## Scope
User stories: unknown skill refused per skill in the list; brief line for one skill, several skills (in list order, commas for three or more) and no skill, each followed by the orientation; decide unchanged whatever the wording. Seams: S2, S3, S4. Out: the new file wording (slice 04); `by:` (slice 04).

## Acceptance
- AC1 Given an agent step with one skill, when its brief is rendered, then Your work reads "Use the `X` skill." followed by the step's instructions. — verifier: test
- AC2 Given an agent step with two skills, when its brief is rendered, then Your work reads "Use the `X` and `Y` skills." in the order listed; with three, "Use the `X`, `Y` and `Z` skills."; then the instructions. — verifier: test
- AC3 Given an agent step with no skills, when its brief is rendered, then Your work names no skill and gives only the instructions. — verifier: test
- AC4 Given a workflow whose agent step lists a skill that is not installed, or not visible to the agent that runs the step, when the workflow is validated, then it is refused with `unknown_skill` naming that skill, for each such skill in the list. — verifier: test
- AC5 Given a story being refined again, when decide reads its workflow, then it recognises the refine step by the step's skills including the refine skill, as it did with the single skill. — verifier: test
- AC6 Given the golden cases with their embedded workflows rewritten from one skill to a list, when the golden suite runs, then every decision is byte-identical to before, and the brief's finish lines (meanings, verdicts) are unchanged in the snapshots. — verifier: test

## Checks
- `bun run test`
- `bun run typecheck`

## Notes
Plan Prefactoring 2, D8. A diff in a golden decision is a bug, never a re-record. Observe snapshots that embed the model move with the field rename only. The orientation becoming required lands in slice 04, not here.
