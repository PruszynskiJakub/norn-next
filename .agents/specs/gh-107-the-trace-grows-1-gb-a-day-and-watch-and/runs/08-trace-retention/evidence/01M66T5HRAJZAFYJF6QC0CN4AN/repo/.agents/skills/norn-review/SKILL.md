---
name: norn-review
description: Review a change on two separate axes — Spec (does it do what was asked, and nothing else) and Standards (the repo's documented rules plus a smell baseline) — in parallel subagents, and write findings as structured JSON with a blocking flag. Read-only. Use when asked to review a diff, branch, pull request or slice against acceptance criteria.
---

# Review

Judge the change; do not fix it. You never edit code during a review.

Two axes, kept apart so one cannot mask the other:

- **Spec**: does the change do what the slice (or story) and the spec ask, and nothing else?
- **Standards**: does it follow this repo's documented standards and the smell baseline?

1. **Pin the diff** against the branch the change targets, or the range you were given: `git diff <base>...HEAD` and `git log <base>..HEAD --oneline`. An empty diff stops the review: report it instead.
2. **Gather the sources.** Spec: the acceptance criteria, the spec's Behaviour items they cite, and its Plan (reviewing a whole story covers the whole spec). Standards: whatever the repo documents about how code is written (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, coding-standard docs, lint and type config), plus [SMELLS.md](SMELLS.md). Run the tests and the type check if you can; a red suite is a blocking finding.
3. **Run each axis in its own subagent**, in parallel, each given the diff command, the commit list and its sources in full. When you cannot start subagents, check both axes yourself.
   - Spec: "Report (a) acceptance criteria or Behaviour items missing or partial, or met for the happy path only; (b) behaviour in the diff nobody asked for, or that the spec lists as out of scope; (c) criteria that look implemented but wrongly; (d) criteria without a test at a seam the Plan agreed, and tests that check internals or recompute their expected value. Quote the spec line for each finding. Under 400 words."
   - Standards: "Report (a) every breach of a documented standard, citing the file and the rule; (b) bugs: off-by-one, null paths, races, resource leaks, wrong units, injection, silent catches, leaked secrets, debug leftovers; (c) each smell from the baseline you spot, named, with the hunk quoted. Breaches of documented standards and bugs can be hard; smells are always judgement calls, and a documented standard overrides the baseline. Skip what tooling enforces. Under 400 words."
4. **Decide.** Every Spec finding, every bug and every hard Standards breach is blocking. Add a smell only when it is worth a round of rework on its own; otherwise it is minor or a nit.
5. **Write the findings** as JSON to a file outside the repository (e.g. under `$TMPDIR`) unless told where. Keep the axes separate; do not merge or rerank them.

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
      "detail": "What is wrong and how you know (test, input, trace); the spec line it breaks.",
      "suggestion": "What would fix it, briefly."
    }
  ]
}
```

- `axis`: `spec` | `standards`. `severity`: `blocking` | `minor` | `nit`. `criterion`, `file`, `line` are optional.
- Each finding is a concrete, checkable point: where, what, why, and how to verify the fix. No vague taste comments.
- Do not repeat a finding; group repeated occurrences into one with all locations in `detail`.

Done when both axes have reported, every criterion was checked, every finding is either in the file or consciously dropped, and the findings file exists (an empty `findings` list is valid) with a summary that says whether any finding is blocking. The verdict is approve, or changes requested with the points.
