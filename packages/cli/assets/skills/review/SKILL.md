---
name: review
description: Review a change against its spec and the repository's standards — two separate axes, a smells pass, and findings written as structured JSON with a blocking flag. Read-only. Use when asked to review a diff, branch, pull request or slice against acceptance criteria.
---

# Review

Judge the change; do not fix it. You never edit code during a review.

## Gather

- The acceptance criteria and the spec items they cite.
- The full diff, plus enough surrounding code to understand it.
- The repository's conventions: contributor docs, agent instructions, lint and type config.
- Run the tests and type check if you can; a red suite is a blocking finding.

## Axis 1: Spec

Review this axis on its own, criterion by criterion:

- Is each acceptance criterion met, and proven by a test that would fail without the change?
- Is any criterion only partly met, or met for the happy path only (check the edge checklist)?
- Does the change do anything the spec did not ask for, or that it lists as out of scope?

## Axis 2: Standards

Then, separately, the code itself:

- Follows the repository's stated rules and existing patterns.
- Tests check behaviour through public interfaces, not internals; mocks only at system boundaries.
- Errors handled at the right level; no silent catches; no leaked secrets; no debug leftovers.
- Bugs: off-by-one, null/undefined paths, races, resource leaks, wrong units, injection.

## Smells

Flag when present: duplicated logic, shallow pass-through modules, long parameter lists, boolean flag arguments, feature envy, dead or commented-out code, magic values, misleading names, tests asserting on implementation details, over-mocking, changes outside the stated scope.

## Findings

Write findings as JSON to a file outside the repository (e.g. under `$TMPDIR`) unless told where:

```json
{
  "summary": "One paragraph: overall verdict and the most important issues.",
  "findings": [
    {
      "id": "F1",
      "axis": "spec",
      "severity": "blocking",
      "criterion": "AC2",
      "file": "src/invites/accept.ts",
      "line": 42,
      "title": "Expired invites are accepted",
      "detail": "What is wrong and how you know (test, input, trace).",
      "suggestion": "What would fix it, briefly."
    }
  ]
}
```

- `axis`: `spec` | `standards`. `severity`: `blocking` | `minor` | `nit`. `criterion`, `file`, `line` are optional.
- **Blocking** = an unmet criterion, a missing test for a criterion, a bug, a failing suite, or a broken repository rule. Everything else is minor or a nit.
- Each finding is specific and actionable: where, what, why, and how to verify the fix. No vague taste comments.
- Do not repeat a finding; group repeated occurrences into one with all locations in `detail`.

## Finished when

Both axes were reviewed separately, every criterion was checked, and the findings file exists (an empty `findings` list is valid) with a summary stating whether any finding is blocking.
