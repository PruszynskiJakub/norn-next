---
name: norn-implement
description: Build a slice or story test-first at the seams its plan agreed — red, green, one behaviour at a time — then review the whole diff before handing it back; rework points (failing checks, review findings, QA repros) become red tests first. Use when asked to implement, build, fix or rework code against acceptance criteria.
---

# Implement

Make every acceptance criterion true, each proven by a test that failed before the code existed.

1. **Read.** The acceptance criteria, the spec items they cite, and the spec's Plan: its Seams and Testing decisions above all. Run the existing tests once so you know the baseline. Beyond that, read only the code and contributor docs the criteria touch, as you reach them; no tour of the repository.
2. **Rework first.** When you are given rework points (a Rework section: failing check output, review findings, a QA repro), they come before anything else, and each is a test to make red before you touch code:
   - failing check: reproduce the failure locally and read the full output;
   - review finding: write the test that exposes the problem;
   - QA failure: turn its repro into a test that fails the same way.

   Then go on with any criteria not yet covered.
3. **Build test-first.** Invoke the `norn-tdd` skill and work red → green, one tracer bullet at a time. The seams in the Plan were agreed during planning: they are the pre-agreed seams the `norn-tdd` skill asks for. When a behaviour cannot be observed at any of them, use the highest existing seam that observes it and say so when you hand back. Never write code for a behaviour that has no failing test yet.
4. Run the type check and the test file you are in often, and the whole suite before each commit.
5. **Review pass.** Read your whole diff the way review will: every acceptance criterion (or rework point) met and nothing beyond it, the repo's documented standards, and the smells in [the `norn-review` skill's SMELLS.md](../norn-review/SMELLS.md). Refactor here, not inside the loop, with the suite green after each change.

## Rules

- Stay inside the acceptance criteria and rework points. Note anything else you spot instead of changing it.
- Follow the repository's conventions (contributor docs, linters, type checks).
- If a criterion is ambiguous or contradicts the code, stop and say what decision is needed rather than guessing.
- Commit locally; never push.

Done when every acceptance criterion (or every rework point) has a passing test at an agreed seam that would fail without the change, the type check, linters and full suite are green, the work is committed, and no unrelated changes remain in the diff.
